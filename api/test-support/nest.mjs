import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { AppModule } from '../dist/app.module.js';
import { CatalogueService } from '../dist/catalogue/catalogue.service.js';
import { APP_CONFIG } from '../dist/config/config.js';
import { DatabaseService } from '../dist/database/database.service.js';
import { AdminService } from '../dist/admin/admin.service.js';

export function createCatalogue(pool, publicBaseUrl) {
  return new CatalogueService({pool},{publicBaseUrl});
}

// A node:http-shaped adapter used by the existing isolated HTTP tests.
export function createApp(catalogue, imageDir, backend = null) {
  let app;
  return {
    listen(port,host,callback) {
      (async () => {
        const config={dbHost:'127.0.0.1',dbPort:3306,dbUser:'test',dbPassword:'test',dbName:'test',publicBaseUrl:'http://localhost',imageDir,port:3000};
        const module=await Test.createTestingModule({imports:[AppModule]})
          .overrideProvider(APP_CONFIG).useValue(config)
          .overrideProvider(DatabaseService).useValue({pool:{}})
          .overrideProvider(CatalogueService).useValue(catalogue)
          .overrideProvider(AdminService).useValue({backend}).compile();
        app=module.createNestApplication({logger:false,bodyParser:false});
        await app.listen(port,host);callback();
      })().catch(error=>{throw error;});
    },
    address() { return app.getHttpServer().address(); },
    close(callback) { app.close().then(()=>callback(),callback); },
  };
}
