import { FileKind } from "@prisma/client";
import { IsEnum, IsInt, IsOptional, IsString, Length, Min } from "class-validator";

export class CreateFileDto {
  @IsString() @Length(1, 1024) path!: string;
  @IsEnum(FileKind) kind!: FileKind;
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsString() mimeType?: string;
}

export class UpdateContentDto {
  @IsString() @Length(1, 1024) path!: string;
  @IsString() content!: string;
  @IsInt() @Min(0) expectedVersion!: number;
}

export class MoveFileDto {
  @IsString() @Length(1, 1024) path!: string;
  @IsString() @Length(1, 1024) newPath!: string;
}

export class SetRootFileDto {
  @IsString() @Length(1, 1024) rootFile!: string;
}
