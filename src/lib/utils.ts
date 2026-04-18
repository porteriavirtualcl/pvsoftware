import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { db, auth } from "../firebase";
import { collection, addDoc, Timestamp } from "firebase/firestore";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type NotificationType = 'incident' | 'expense' | 'reservation' | 'visitor' | 'info';

export async function sendNotification(
  userId: string,
  title: string,
  message: string,
  type: NotificationType = 'info',
  link?: string
) {
  try {
    await addDoc(collection(db, 'notifications'), {
      userId,
      title,
      message,
      type,
      link: link || null,
      read: false,
      createdAt: Timestamp.now()
    });
  } catch (error) {
    console.error("Error sending notification:", error);
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

// ─── Incident PDF (print-to-PDF, zero extra dependencies) ────────────────────

interface IncidentPDFData {
  type: 'initial' | 'closure';
  incidentId: string;
  condoName: string;
  equipmentName: string;
  description: string;
  priority: string;
  reportedByName: string;
  createdAt: Date;
  closingObservations?: string;
  closedByName?: string;
  closedAt?: Date;
}

export function printIncidentReport(data: IncidentPDFData) {
  const priorityLabels: Record<string, string> = { low: 'Baja', medium: 'Media', high: 'Alta', critical: 'Crítica' };
  const priorityColors: Record<string, string> = { low: '#3b82f6', medium: '#eab308', high: '#f97316', critical: '#ef4444' };
  const color = priorityColors[data.priority] || '#6b7280';
  const label = priorityLabels[data.priority] || data.priority;
  const fmt = (d?: Date) => d ? d.toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"/>
<title>Reporte #${data.incidentId.slice(-6).toUpperCase()}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Segoe UI',Arial,sans-serif;background:#fff;color:#1a1a2e;padding:40px}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1e293b;padding-bottom:20px;margin-bottom:28px}
  .logo{font-size:22px;font-weight:900;color:#1e293b}.logo span{color:#3b82f6}
  .doctype{text-align:right}.doctype h2{font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:2px}
  .doctype .id{font-size:26px;font-weight:900;color:#1e293b}
  .badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:800;color:#fff;background:${color}}
  .section{margin-bottom:22px}.section h3{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:#6b7280;margin-bottom:10px;border-bottom:1px solid #e5e7eb;padding-bottom:5px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .field label{font-size:10px;font-weight:700;text-transform:uppercase;color:#9ca3af;display:block;margin-bottom:3px}
  .field p{font-size:14px;font-weight:600;color:#1e293b}
  .box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;font-size:13px;line-height:1.7;color:#374151}
  .footer{margin-top:40px;padding-top:18px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:11px;color:#9ca3af}
  @media print{body{padding:20px}}
</style></head><body>
<div class="hdr">
  <div class="logo">Porteria<span>Virtual</span></div>
  <div class="doctype">
    <h2>${data.type === 'initial' ? 'Reporte Inicial de Incidente' : 'Informe de Cierre'}</h2>
    <div class="id">#${data.incidentId.slice(-6).toUpperCase()}</div>
  </div>
</div>
<div class="section">
  <h3>Datos del Incidente</h3>
  <div class="grid">
    <div class="field"><label>Condominio</label><p>${data.condoName}</p></div>
    <div class="field"><label>Prioridad</label><p><span class="badge">${label}</span></p></div>
    <div class="field"><label>Equipamiento afectado</label><p>${data.equipmentName}</p></div>
    <div class="field"><label>Fecha de reporte</label><p>${fmt(data.createdAt)}</p></div>
    <div class="field"><label>Reportado por</label><p>${data.reportedByName}</p></div>
  </div>
</div>
<div class="section">
  <h3>Descripción del Problema</h3>
  <div class="box">${data.description}</div>
</div>
${data.type === 'closure' ? `
<div class="section">
  <h3>Resolución</h3>
  <div class="grid" style="margin-bottom:12px">
    <div class="field"><label>Fecha de cierre</label><p>${fmt(data.closedAt)}</p></div>
    <div class="field"><label>Cerrado por</label><p>${data.closedByName || '—'}</p></div>
  </div>
  <h3>Observaciones de Cierre</h3>
  <div class="box">${data.closingObservations || '—'}</div>
</div>` : ''}
<div class="footer">
  <span>Portería Virtual — Sistema de Gestión de Condominios</span>
  <span>Generado: ${new Date().toLocaleDateString('es-CL')}</span>
</div>
</body></html>`;

  const w = window.open('', '_blank', 'width=820,height=640');
  if (w) { w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 500); }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
