import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SettingsModule } from '../settings/settings.module';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { Expense, ExpenseSchema } from './schemas/expense.schema';
import { ExpenseCategory, ExpenseCategorySchema } from './schemas/expense-category.schema';
import { SchoolYear, SchoolYearSchema } from '../school-years/schemas/school-year.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Expense.name, schema: ExpenseSchema },
      { name: ExpenseCategory.name, schema: ExpenseCategorySchema },
      { name: SchoolYear.name, schema: SchoolYearSchema },
    ]),
    SettingsModule,
  ],
  controllers: [ExpensesController],
  providers: [ExpensesService],
  exports: [ExpensesService, MongooseModule],
})
export class ExpensesModule {}
