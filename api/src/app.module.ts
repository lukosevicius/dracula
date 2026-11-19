import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from './config/config.js';
import { DatabaseService } from './database/database.service.js';
import { HealthController } from './health/health.controller.js';
import { CatalogueController } from './catalogue/catalogue.controller.js';
import { CatalogueService } from './catalogue/catalogue.service.js';
import { CommonHeadersMiddleware } from './common-headers.middleware.js';
import { AdminController } from './admin/admin.controller.js';
import { AdminService } from './admin/admin.service.js';
import { AdminGuard } from './admin/admin.guard.js';
import { ImportsService } from './imports/imports.service.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';

@Module({
  controllers: [HealthController, CatalogueController, AdminController, AuthController],
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig(process.env) }, DatabaseService, CatalogueService, AdminService, AdminGuard, ImportsService, AuthService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void { consumer.apply(CommonHeadersMiddleware).forRoutes('*path'); }
}
