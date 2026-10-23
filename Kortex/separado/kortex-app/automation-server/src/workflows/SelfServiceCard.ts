import { createHash, randomUUID } from 'node:crypto';
import { AutomationError, assertNotAborted } from '../errors.js';
import type { OperationArtifact, OperationRecord } from '../types.js';
import type { WorkflowContext } from './WorkflowContext.js';
import { HapvidaLoginPage } from './hapvida/pageObjects/HapvidaLoginPage.js';
import { HapvidaCardPage } from './hapvida/pageObjects/HapvidaCardPage.js';
import { cardRowFingerprint } from './hapvida/cardBeneficiaryChoice.js';
import type { CardListRow } from './hapvida/cardList.js';
import { createNativeCardDelivery } from './hapvida/nativeCardDelivery.js';
import { validateCardPdfBytes } from './hapvida/downloadValidation.js';
import { normalizePortalLoginCode } from '../credentials/credentialIdentity.js';

const nameKey=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
const digits=(value:string|undefined)=>(value??'').replace(/\D/g,'');
export function verifySelfCardCompany(text:string,expected:string){
 const pattern=nameKey(expected).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 if(!pattern||!new RegExp('(?:^|[^a-z0-9])'+pattern+'(?:$|[^a-z0-9])').test(nameKey(text)))throw new AutomationError('SELF_COMPANY_NOT_VERIFIED','A empresa do documento nao corresponde ao pedido.');
}
export function verifiedSelfCardRow(rows:CardListRow[],input:{beneficiaryName:string;cpf:string;birthDate:string},registryVerified=false) {
 if((!registryVerified&&!/^\d{11}$/.test(digits(input.cpf)))||!/^\d{4}-\d{2}-\d{2}$/.test(input.birthDate))throw new AutomationError('SELF_IDENTITY_NOT_VERIFIED','Nao foi possivel validar a identidade do beneficiario.');
 const dob=input.birthDate.replace(/^(\d{4})-(\d{2})-(\d{2})$/,'$3/$2/$1');
 if(registryVerified){
  const named=rows.filter(row=>row.visible&&row.selectable&&row.kind==='beneficiary'&&nameKey(row.beneficiaryName)===nameKey(input.beneficiaryName));
  if(named.length!==1||!named[0]!.cardIdentifiers?.length||(input.cpf&&named[0]!.cpf&&digits(named[0]!.cpf)!==digits(input.cpf)))throw new AutomationError('SELF_IDENTITY_NOT_VERIFIED','Nao foi possivel validar a identidade do beneficiario.');
  return named[0]!;
 }
 const candidates=rows.filter(row=>row.visible&&row.selectable&&row.kind==='beneficiary'
  &&nameKey(row.beneficiaryName)===nameKey(input.beneficiaryName)
  &&digits(row.cpf)===digits(input.cpf)
  &&new RegExp('(?:^|[^0-9])'+dob.replaceAll('/','[/.\\-]')+'(?:$|[^0-9])').test(row.text??''));
 if(candidates.length!==1)throw new AutomationError('SELF_IDENTITY_NOT_VERIFIED','Nao foi possivel validar a identidade do beneficiario.',{step:'verify_self_identity',retryable:false});
 return candidates[0]!;
}

// Reuse the local tool's login, selection, native renderer and private storage.
// This separate workflow cannot select a whole company or another family member.
export async function emitSelfServiceCard(operation:OperationRecord,signal:AbortSignal,context:WorkflowContext & {
 verifySavedBeneficiary?:(identity:{beneficiaryName:string;cpf:string;birthDate:string})=>Promise<{verified:boolean;sourceSha256?:string}>
}) {
 const {beneficiaryName,cpf,birthDate,contractCode,periodStart,periodEnd}=operation.input;
 if([beneficiaryName,birthDate,contractCode,periodStart,periodEnd].some(v=>typeof v!=='string'||!v.trim())||typeof cpf!=='string'
  ||operation.type!=='CARD_ISSUE'||operation.input.beneficiaryScope!=='single')throw new AutomationError('SELF_CARD_INPUT_INVALID','Dados de emissao incompletos.');
 const input={beneficiaryName:beneficiaryName as string,cpf:cpf as string,birthDate:birthDate as string};
 const registryProof=typeof operation.input.expectedCompanyName==='string'&&context.verifySavedBeneficiary?await context.verifySavedBeneficiary(input):{verified:false};
 const method=registryProof.verified?'source_registry_and_portal_card':'portal_name_cpf_birth_date';
 const portalUrl=operation.portal==='ndi'?context.config.ndiCardPortalUrl:context.config.hapvidaCardPortalUrl;
 if(!portalUrl)throw new AutomationError('PORTAL_URL_NOT_CONFIGURED','Portal indisponivel.');
 const credential=await context.secretProvider.get(operation.credentialRef);
 if(normalizePortalLoginCode(credential.username)!==normalizePortalLoginCode(contractCode as string))throw new AutomationError('CREDENTIAL_SCOPE_MISMATCH','Acesso da empresa indisponivel.');
 await context.browserManager.withContext(operation,signal,async(browser,page)=>{
  context.browserManager.validateAllowedUrl(portalUrl,operation);
  const login=new HapvidaLoginPage(page,portalUrl,context.config.authTimeoutMs,operation.portal==='ndi'?'NDI':'Hapvida');
  const card=new HapvidaCardPage(page,context.config.actionTimeoutMs,portalUrl);
  await context.updateStatus('authenticating','Validando acesso local da empresa');
  await browser.clearCookies();await login.open();await login.waitForReady();await login.login(credential);
  assertNotAborted(signal);
  if(await login.invalidIdentificationMessage().isVisible().catch(()=>false))throw new AutomationError('AUTHENTICATION_FAILED','O acesso salvo precisa de revisao pela equipe.');
  await card.waitForPeriodForm(context.config.authTimeoutMs);
  await context.updateStatus('processing','Conferindo identidade na operadora');
  const portalDate=(value:unknown)=>String(value).replace(/^(\d{4})-(\d{2})-(\d{2})$/,'$3/$2/$1');
  await card.fillPeriod(portalDate(periodStart),portalDate(periodEnd));await card.submitPeriod();assertNotAborted(signal);
  const row=verifiedSelfCardRow(await card.inspectBeneficiaryCandidates(input),input,registryProof.verified);
  const target={...input,cardIdentifiers:row.cardIdentifiers,requireIdentifier:true,rowFingerprint:cardRowFingerprint(row)};
  const family=await card.inspectBeneficiaryFamily(target);
  const excluded=family.otherBeneficiaries??family.dependents;
  const selected=await card.selectBeneficiary(target,family.automaticCompanions??family.dependents);
  assertNotAborted(signal);
  const resultPage=await card.requestSelectedCards([selected],false);
  const resultCard=new HapvidaCardPage(resultPage,context.config.actionTimeoutMs,portalUrl);
  const frame=await resultCard.waitForCardPreview(selected,excluded);
  if(!frame)throw new AutomationError('CARD_PREVIEW_NOT_FOUND','Nao foi possivel validar o documento.');
  if(typeof operation.input.expectedCompanyName==='string')verifySelfCardCompany(await frame.locator('body').innerText(),operation.input.expectedCompanyName);
  await context.updateStatus('verifying','Validando arquivo da propria carteirinha');
  const delivery=await createNativeCardDelivery(resultPage,[frame],[selected],excluded,input.beneficiaryName,signal);
  const bytes=validateCardPdfBytes(delivery.bytes,'carteirinha.pdf');assertNotAborted(signal);
  const saved=await context.artifactStorage.save({operationId:operation.id,workspaceId:operation.workspaceId,fileName:'carteirinha.pdf',mimeType:'application/pdf',bytes,type:'card_pdf',
   metadata:{selfService:true,identityVerified:true,identityMethod:method,beneficiaryCount:1}});
  const artifact:OperationArtifact={id:randomUUID(),...saved,path:saved.storagePath,kind:'pdf',artifactType:'card_pdf',createdAt:new Date().toISOString(),
   metadata:{selfService:true,identityVerified:true,beneficiaryCount:1}};
  const proof=createHash('sha256').update(JSON.stringify([nameKey(input.beneficiaryName),digits(input.cpf),input.birthDate])).digest('hex');
  await context.repository.update(operation.id,{artifacts:[artifact],result:{selfServiceIdentity:{verified:true,method,fingerprint:proof,...(registryProof.verified?{sourceSha256:registryProof.sourceSha256}:{})},beneficiaryCount:1},updatedAt:new Date().toISOString()});
  await context.updateStatus('success','Carteirinha individual emitida e validada');
 });
}
