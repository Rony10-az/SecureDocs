import { prisma } from "../db";
import { PolicyEngine } from "./abac/policy-engine";
import { PoliticasRepo } from "./abac/politicas.repo";
import { Autorizador } from "./autorizador";
import { RbacService } from "./rbac/rbac.service";

// Único lugar donde se conectan las piezas con la BD real. Las pruebas unitarias arman las suyas con datos en memoria.
export const rbacService = new RbacService(prisma);
export const politicasRepo = new PoliticasRepo(prisma);
export const policyEngine = new PolicyEngine(politicasRepo);
export const autorizador = new Autorizador(rbacService, policyEngine);
