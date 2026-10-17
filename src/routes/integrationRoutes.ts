import { Router } from "express";
import isAuth from "../middleware/isAuth";
import isAdmin from "../middleware/isAdmin";
import isSuper from "../middleware/isSuper";
import * as IntegrationController from "../controllers/IntegrationController";

const integrationRoutes = Router();

integrationRoutes.get("/integrations/catalog", isAuth, isSuper, IntegrationController.catalog);
integrationRoutes.get("/integrations", isAuth, IntegrationController.index);
// Plamev tools: any user of the company; plan and connection are checked in the service.
integrationRoutes.get("/integrations/plamev/estados", isAuth, IntegrationController.plamevEstados);
integrationRoutes.get("/integrations/plamev/cidades", isAuth, IntegrationController.plamevCidades);
integrationRoutes.get("/integrations/plamev/bairros", isAuth, IntegrationController.plamevBairros);
integrationRoutes.get("/integrations/plamev/cep", isAuth, IntegrationController.plamevCep);
integrationRoutes.post("/integrations/plamev/rede-imagem", isAuth, IntegrationController.plamevImagem);
integrationRoutes.get("/integrations/plamev/planos", isAuth, IntegrationController.plamevPlanos);
integrationRoutes.post("/integrations/plamev/plano-imagem", isAuth, IntegrationController.plamevPlanoImagem);
integrationRoutes.get("/integrations/plamev/racas", isAuth, IntegrationController.plamevRacas);
integrationRoutes.get("/integrations/plamev/campanhas", isAuth, IntegrationController.plamevCampanhas);
integrationRoutes.get("/integrations/plamev/tabelas", isAuth, IntegrationController.plamevTabelas);
integrationRoutes.post("/integrations/plamev/cotacao/simular", isAuth, IntegrationController.plamevSimular);
integrationRoutes.post("/integrations/plamev/cotacao-imagem", isAuth, IntegrationController.plamevCotacaoImagem);
integrationRoutes.get("/integrations/plamev/credenciados", isAuth, IntegrationController.plamevCredenciados);
integrationRoutes.get("/integrations/plamev/proximidade", isAuth, IntegrationController.plamevProximidade);
integrationRoutes.put("/integrations/:provider", isAuth, isAdmin, IntegrationController.update);
integrationRoutes.post("/integrations/:provider/test", isAuth, isAdmin, IntegrationController.test);
integrationRoutes.delete("/integrations/:provider", isAuth, isAdmin, IntegrationController.remove);

export default integrationRoutes;
