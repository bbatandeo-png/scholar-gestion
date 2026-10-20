import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { EnrollmentStatus, LevelCycle } from '../common/enums/domain.enums';
import { CreateLevelDto } from './dto/create-level.dto';
import { Level, LevelDocument } from './schemas/level.schema';
import {
  SchoolYearLevel,
  SchoolYearLevelDocument,
} from './schemas/school-year-level.schema';

export type LevelWithStatus = {
  _id: string;
  code: string;
  label: string;
  sortOrder: number;
  cycle?: LevelCycle;
  isEnabled: boolean;
};

@Injectable()
export class LevelsService {
  constructor(
    @InjectModel(Level.name) private readonly levelModel: Model<LevelDocument>,
    @InjectModel(SchoolYearLevel.name)
    private readonly schoolYearLevelModel: Model<SchoolYearLevelDocument>,
  ) {}

  async create(dto: CreateLevelDto) {
    return this.levelModel.create(dto);
  }

  async list() {
    return this.levelModel.find().sort({ sortOrder: 1 }).lean().exec();
  }

  async listForSchoolYear(schoolYearId: string) {
    const links = (await this.schoolYearLevelModel
      .find({ schoolYearId, isEnabled: true })
      .populate('levelId')
      .lean()
      .exec()) as unknown as Array<{ levelId?: Level & { _id: unknown } }>;
    return links
      .map((item) => item.levelId)
      .filter((level): level is Level & { _id: unknown } => Boolean(level))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // Tous les niveaux de l'ecole, avec leur etat pour l'annee : l'ecran
  // Parametres > Niveaux doit montrer aussi les niveaux desactives (sinon
  // impossible de les reactiver). Partout ailleurs, listForSchoolYear() ne
  // renvoie que les niveaux actifs.
  async listAllForSchoolYear(schoolYearId: string): Promise<LevelWithStatus[]> {
    const [levels, links] = await Promise.all([
      this.levelModel.find().sort({ sortOrder: 1 }).lean().exec(),
      this.schoolYearLevelModel.find({ schoolYearId }).lean().exec(),
    ]);
    const enabledIds = new Set(
      links
        .filter((link) => link.isEnabled)
        .map((link) => String(link.levelId)),
    );
    return levels.map((level) => ({
      _id: String(level._id),
      code: level.code,
      label: level.label,
      sortOrder: level.sortOrder,
      cycle: level.cycle,
      isEnabled: enabledIds.has(String(level._id)),
    }));
  }

  // Active / desactive un niveau pour une annee (le niveau lui-meme n'est
  // jamais supprime). Une ecole sans lycee desactive ainsi 2nde-Terminale
  // crees par le seeder : ils disparaissent des inscriptions, frais,
  // listes et bulletins de l'annee.
  async setEnabledForSchoolYear(
    schoolYearId: string,
    levelId: string,
    enabled: boolean,
  ) {
    const level = await this.levelModel.findById(levelId).lean().exec();
    if (!level) {
      throw new NotFoundException('Niveau introuvable');
    }
    if (!enabled) {
      // Le modele Enrollment appartient a EnrollmentsModule (qui depend
      // deja de LevelsModule) : on le recupere via la connexion pour eviter
      // une dependance circulaire entre modules.
      const enrollmentModel = this.levelModel.db.models.Enrollment as
        | Model<{ schoolYearId: unknown; levelId: unknown; status: string }>
        | undefined;
      const activeCount = enrollmentModel
        ? await enrollmentModel.countDocuments({
            schoolYearId,
            levelId,
            status: EnrollmentStatus.ACTIVE,
          })
        : 0;
      if (activeCount > 0) {
        throw new BadRequestException(
          `Impossible de désactiver ${level.label} : ${activeCount} élève(s) y sont inscrits cette année. Changez-les de classe ou clôturez leurs inscriptions d'abord.`,
        );
      }
    }
    await this.schoolYearLevelModel.findOneAndUpdate(
      { schoolYearId, levelId },
      { schoolYearId, levelId, isEnabled: enabled },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return level;
  }

  async enableForSchoolYear(schoolYearId: string, levelId: string) {
    return this.schoolYearLevelModel.findOneAndUpdate(
      { schoolYearId, levelId },
      { schoolYearId, levelId, isEnabled: true },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  async copyYearConfiguration(
    sourceSchoolYearId: string,
    targetSchoolYearId: string,
    session?: ClientSession,
  ) {
    const sourceLinks = await this.schoolYearLevelModel
      .find({ schoolYearId: sourceSchoolYearId, isEnabled: true })
      .session(session ?? null)
      .lean()
      .exec();
    for (const link of sourceLinks) {
      await this.schoolYearLevelModel.updateOne(
        { schoolYearId: targetSchoolYearId, levelId: link.levelId },
        {
          $setOnInsert: {
            schoolYearId: targetSchoolYearId,
            levelId: link.levelId,
            isEnabled: true,
          },
        },
        { upsert: true, session },
      );
    }
  }

  async findById(id: string) {
    return this.levelModel.findById(id).lean().exec();
  }

  async update(id: string, dto: CreateLevelDto) {
    return this.levelModel
      .findByIdAndUpdate(id, dto, { new: true })
      .lean()
      .exec();
  }

  async findNextLevel(levelId: string) {
    const level = await this.levelModel.findById(levelId).lean().exec();
    if (!level) {
      return null;
    }

    return this.levelModel
      .findOne({ sortOrder: level.sortOrder + 1 })
      .lean()
      .exec();
  }
}
