export type LeanDoc<T> = T & {
  _id: string;
  createdAt?: Date;
  updatedAt?: Date;
};