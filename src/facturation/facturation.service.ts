import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import PDFDocument from 'pdfkit';
import {
  FacturationMode,
  FactureStatut,
  TypeEvenementConsommation,
} from '../common/enums/domain.enums';
import { runWithMongoTransactionFallback } from '../common/utils/mongo-transaction.util';
import { ChangeParametreFacturationDto } from './dto/change-parametre-facturation.dto';
import { GenererFactureDto } from './dto/generer-facture.dto';
import {
  Consommation,
  ConsommationDocument,
} from './schemas/consommation.schema';
import {
  Facture,
  FactureDocument,
  FactureLigne,
} from './schemas/facture.schema';
import {
  ParametreFacturation,
  ParametreFacturationDocument,
} from './schemas/parametre-facturation.schema';

@Injectable()
export class FacturationService {
  constructor(
    @InjectModel(ParametreFacturation.name)
    private readonly parametreModel: Model<ParametreFacturationDocument>,
    @InjectModel(Consommation.name)
    private readonly consommationModel: Model<ConsommationDocument>,
    @InjectModel(Facture.name)
    private readonly factureModel: Model<FactureDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  private generateNumero() {
    const stamp = new Date()
      .toISOString()
      .replace(/[-:TZ.]/g, '')
      .slice(0, 14);
    const random = Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, '0');
    return `FACT-${stamp}-${random}`;
  }

  async getParametreActif() {
    return this.parametreModel.findOne({ dateFin: null }).lean().exec();
  }

  async changeParametre(dto: ChangeParametreFacturationDto) {
    return runWithMongoTransactionFallback(this.connection, async (session) => {
      const now = new Date();
      await this.parametreModel.updateOne(
        { dateFin: null },
        { dateFin: now },
        { session },
      );
      const [created] = await this.parametreModel.create(
        [
          {
            mode: dto.mode,
            sousType: dto.sousType,
            montantUnitaire: dto.montantUnitaire,
            dateEffet: now,
            dateFin: null,
          },
        ],
        { session },
      );
      return created;
    });
  }

  // Integration contract for the (future) Bulletins module: call this every
  // time a bulletin is generated. Idempotent by construction - the unique
  // partial index on {ecoleId, eleveId, periode, typeEvenement:'bulletin'}
  // means regenerating a bulletin for the same eleve/periode never creates a
  // second billable row.
  async recordBulletinGeneration(payload: {
    eleveId: string;
    classeId: string;
    periode: string;
    anneeScolaireId: string;
  }) {
    return this.consommationModel.findOneAndUpdate(
      {
        eleveId: payload.eleveId,
        periode: payload.periode,
        typeEvenement: TypeEvenementConsommation.BULLETIN,
      },
      {
        $setOnInsert: {
          classeId: payload.classeId,
          anneeScolaireId: payload.anneeScolaireId,
          date: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  // Same idempotency guarantee, keyed on {ecoleId, eleveId, anneeScolaireId}
  // instead: an eleve is only billable once per school year no matter how
  // many periods or regenerations occur within it.
  async recordEleveUsage(payload: {
    eleveId: string;
    classeId: string;
    anneeScolaireId: string;
    periode: string;
  }) {
    return this.consommationModel.findOneAndUpdate(
      {
        eleveId: payload.eleveId,
        anneeScolaireId: payload.anneeScolaireId,
        typeEvenement: TypeEvenementConsommation.USAGE_ELEVE,
      },
      {
        $setOnInsert: {
          classeId: payload.classeId,
          periode: payload.periode,
          date: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  async listFactures() {
    return this.factureModel.find().sort({ dateGeneration: -1 }).lean().exec();
  }

  async findFactureById(id: string) {
    const facture = await this.factureModel.findById(id).lean().exec();
    if (!facture) {
      throw new NotFoundException('Facture introuvable');
    }
    return facture;
  }

  async genererFacture(dto: GenererFactureDto) {
    return runWithMongoTransactionFallback(this.connection, async (session) => {
      const parametre = await this.parametreModel
        .findOne({ dateFin: null })
        .session(session ?? null)
        .exec();
      if (!parametre) {
        throw new BadRequestException(
          'Aucun parametre de facturation actif pour cette ecole',
        );
      }

      const classeId = dto.classeId ?? null;
      let lignes: FactureLigne[];
      let montantTotal: number;
      let consommationIds: Types.ObjectId[] = [];

      if (parametre.mode === FacturationMode.FORFAIT) {
        const already = await this.factureModel
          .findOne({ periode: dto.periode, classeId })
          .session(session ?? null)
          .exec();
        if (already) {
          throw new BadRequestException(
            'Une facture forfait existe deja pour cette periode',
          );
        }
        montantTotal = parametre.montantUnitaire;
        lignes = [
          {
            label: `Abonnement forfait - ${dto.periode}`,
            quantite: 1,
            prixUnitaire: parametre.montantUnitaire,
            sousTotal: parametre.montantUnitaire,
          },
        ];
      } else {
        const typeEvenement =
          parametre.mode === FacturationMode.USAGE_BULLETIN
            ? TypeEvenementConsommation.BULLETIN
            : TypeEvenementConsommation.USAGE_ELEVE;
        const rows = await this.consommationModel
          .find({
            factureId: null,
            typeEvenement,
            ...(dto.classeId ? { classeId: dto.classeId } : {}),
          })
          .session(session ?? null)
          .exec();
        if (!rows.length) {
          throw new BadRequestException(
            'Aucune consommation facturable pour cette periode/classe',
          );
        }
        consommationIds = rows.map((row) => row._id);
        const quantite = rows.length;
        montantTotal = quantite * parametre.montantUnitaire;
        lignes = [
          {
            label:
              parametre.mode === FacturationMode.USAGE_BULLETIN
                ? 'Bulletins generes'
                : 'Eleves factures',
            quantite,
            prixUnitaire: parametre.montantUnitaire,
            sousTotal: montantTotal,
          },
        ];
      }

      const [facture] = await this.factureModel.create(
        [
          {
            numero: this.generateNumero(),
            classeId,
            periode: dto.periode,
            dateGeneration: new Date(),
            lignes,
            montantTotal,
            statut: FactureStatut.EMISE,
          },
        ],
        { session },
      );

      if (consommationIds.length) {
        await this.consommationModel.updateMany(
          { _id: { $in: consommationIds } },
          { factureId: facture._id },
          { session },
        );
      }

      return facture;
    });
  }

  async genererFacturePdf(id: string): Promise<Buffer> {
    const facture = await this.findFactureById(id);
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    return await new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      doc.fontSize(18).text('Facture', { align: 'center' });
      doc.moveDown();
      doc.fontSize(11);
      doc.text(`Numero : ${facture.numero}`);
      doc.text(`Periode : ${facture.periode}`);
      doc.text(
        `Date de generation : ${new Date(facture.dateGeneration).toLocaleDateString('fr-FR')}`,
      );
      doc.moveDown();

      for (const ligne of facture.lignes) {
        doc.text(
          `${ligne.label} — ${ligne.quantite} x ${ligne.prixUnitaire.toLocaleString('fr-FR')} = ${ligne.sousTotal.toLocaleString('fr-FR')}`,
        );
      }

      doc.moveDown();
      doc
        .fontSize(14)
        .text(`Total : ${facture.montantTotal.toLocaleString('fr-FR')}`, {
          align: 'right',
        });

      doc.end();
    });
  }
}
