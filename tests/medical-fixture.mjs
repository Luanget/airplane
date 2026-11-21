import {newState} from '../health/core.mjs';
import {saveMedicalReport,saveMedicalNote} from '../health/medical.mjs';

export const lab=(overrides={})=>({name:'空腹血糖',code:'1558-6',value:5.8,result:null,unit:'mmol/L',
 reference:'3.9–6.1 mmol/L',method:'己糖激酶法',evidence:'空腹血糖 1558-6 5.8 mmol/L 参考 3.9–6.1 mmol/L 己糖激酶法',uncertainty:null,...overrides});
export const reportCandidate=(date,overrides={})=>({message:'转录完毕。',report:{date,dateEvidence:'体检日期 '+date,
 institution:'合成体检机构',note:null,uncertainty:null,measurements:[lab()],...overrides}});
export function medicalFixture(){
 const state=newState();
 saveMedicalReport(state,{date:'2021-02-10',institution:'合成体检机构',measurements:[lab({value:5.2})]});
 saveMedicalReport(state,{date:'2022-03-07',institution:'合成体检机构',measurements:[lab({value:6.0,reference:'3.9–5.9 mmol/L'}),
  lab({name:'载体专用私密指标',code:null,value:17})]});
 saveMedicalNote(state,'symptoms',{date:'2022-03-07',time:'16:03',description:'合成就诊前头晕',change:'已缓解',visit:'计划复查'});
 saveMedicalNote(state,'profile',{name:'不出设备验证资料',birthDate:'1995-10-10'});
 return state;
}
export function syntheticPdf(title='Synthetic checkup'){
 // Minimal one-page PDF with a real cross-reference table.
 const stream='BT /F1 12 Tf 35 160 Td ('+title+') Tj ET';
 const objects=[
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
  '<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
 ];
 let pdf='%PDF-1.4\n';
 const offsets=[0];
 for(const [index,content] of objects.entries()){
  offsets.push(pdf.length);
  pdf+=(index+1)+' 0 obj\n'+content+'\nendobj\n';
 }
 const xref=pdf.length;
 pdf+='xref\n0 '+offsets.length+'\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>
  String(offset).padStart(10,'0')+' 00000 n \n').join('');
 pdf+='trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
 return pdf;
}
