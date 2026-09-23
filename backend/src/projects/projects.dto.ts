import { IsEmail, IsEnum, IsOptional, IsString, Length, Matches } from "class-validator";
import { ProjectRole } from "@prisma/client";

export class CreateProjectDto {
  @IsString()
  @Length(1, 128)
  @Matches(/^[^\p{Cc}]+$/u)
  name!: string;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @Length(1, 128)
  @Matches(/^[^\p{Cc}]+$/u)
  name?: string;
}

export class UpdateSettingsDto {
  @IsString()
  @Length(1, 1024)
  rootFile!: string;
}

export class AddMemberDto {
  @IsEmail()
  email!: string;

  @IsEnum(ProjectRole)
  role!: ProjectRole;
}

export class UpdateMemberDto {
  @IsEnum(ProjectRole)
  role!: ProjectRole;
}
