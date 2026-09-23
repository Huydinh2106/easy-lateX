import { Global, Module } from "@nestjs/common";
import { APP_CONFIG } from "./tokens";
import { readConfig } from "./config";

@Global()
@Module({ providers: [{ provide: APP_CONFIG, useFactory: readConfig }], exports: [APP_CONFIG] })
export class AppConfigModule {}
