import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EcoleModulesModule } from '../ecole-modules/ecole-modules.module';
import { EcolesModule } from '../ecoles/ecoles.module';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { Expense, ExpenseSchema } from './schemas/expense.schema';
import {
  ExpenseCategory,
  ExpenseCategorySchema,
} from './schemas/expense-category.schema';
import {
  SchoolYear,
  SchoolYearSchema,
} from '../school-years/schemas/school-year.schema';
import { SchoolYearsModule } from '../school-years/school-years.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Expense.name, schema: ExpenseSchema },
      { name: ExpenseCategory.name, schema: ExpenseCategorySchema },
      { name: SchoolYear.name, schema: SchoolYearSchema },
    ]),
    SchoolYearsModule,
    EcoleModulesModule,
    EcolesModule,
  ],
  controllers: [ExpensesController],
  providers: [ExpensesService],
  exports: [ExpensesService, MongooseModule],
})
export class ExpensesModule {}
