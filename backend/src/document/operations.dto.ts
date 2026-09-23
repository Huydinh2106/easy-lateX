import { IsIn, IsInt, IsOptional, IsString, Min } from "class-validator";

export class SourceOperationDto {
  @IsIn(["INSERT_TEXT", "REPLACE_RANGE", "DELETE_RANGE"])
  operationType!: "INSERT_TEXT" | "REPLACE_RANGE" | "DELETE_RANGE";
  @IsString() path!: string;
  @IsInt() @Min(0) baseVersion!: number;
  @IsInt() @Min(0) start!: number;
  @IsOptional() @IsInt() @Min(0) end?: number;
  @IsOptional() @IsString() text?: string;
}
