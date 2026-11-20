import {displayDay} from '../calendar.mjs';
import {utcDay} from './core.mjs';

const left=38,right=336,top=10,bottom=100;
export function renderWeightChart(svg,output,points){
 svg.onpointerdown=svg.onpointermove=svg.onkeydown=null;
 svg.toggleAttribute('hidden',!points.length);
 if(!points.length){output.textContent='暂无有效晨重记录';return;}
 let min=Infinity,max=-Infinity;
 for(const {kg} of points){min=Math.min(min,kg);max=Math.max(max,kg);}
 min=Math.floor(min*2)/2-.5;max=Math.ceil(max*2)/2+.5;
 const start=utcDay(points[0].date),days=utcDay(points.at(-1).date)-start;
 const xs=points.map(({date})=>days?left+(utcDay(date)-start)/days*(right-left):(left+right)/2);
 const y=kg=>bottom-(kg-min)/(max-min)*(bottom-top);
 const ticks=[max,(min+max)/2,min];
 const path=points.map(({kg},i)=>`${i?'L':'M'}${xs[i].toFixed(2)},${y(kg).toFixed(2)}`).join(' ');
 const dates=days?[points[0].date,points.at(-1).date]:[points[0].date];
 svg.innerHTML=ticks.map(kg=>`<line x1="${left}" x2="${right}" y1="${y(kg)}" y2="${y(kg)}" class="chart-grid"/><text x="3" y="${y(kg)+4}">${kg.toFixed(1)}</text>`).join('')+
  `<path d="${path}" class="weight-line"/><line class="weight-crosshair" y1="${top}" y2="${bottom}"/><circle class="weight-marker" r="4.5"/>`+
  dates.map((date,i)=>`<text x="${days?(i?right:left):xs[0]}" y="124" text-anchor="${days?(i?'end':'start'):'middle'}">${displayDay(date)}</text>`).join('');
 const marker=svg.querySelector('circle'),crosshair=svg.querySelector('.weight-crosshair');
 let current=-1;
 function select(index){
  if(index===current)return;
  current=index;
  const {date,kg}=points[index],x=xs[index];
  marker.setAttribute('cx',x);marker.setAttribute('cy',y(kg));
  crosshair.setAttribute('x1',x);crosshair.setAttribute('x2',x);
  svg.setAttribute('aria-valuenow',index+1);
  const value=displayDay(date,true)+' · '+kg.toFixed(1)+' kg';
  svg.setAttribute('aria-valuetext',value);output.textContent=value;
 }
 function pointAt(event){
  const matrix=svg.getScreenCTM();
  if(!matrix)return;
  const target=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse()).x;
  let closest=0;
  for(let i=1;i<xs.length;i++)if(Math.abs(xs[i]-target)<Math.abs(xs[closest]-target))closest=i;
  select(closest);
 }
 svg.setAttribute('aria-valuemax',points.length);
 svg.onpointerdown=event=>{
  if(event.button!==0||!event.isPrimary)return;
  svg.setPointerCapture(event.pointerId);pointAt(event);
 };
 svg.onpointermove=event=>{
  if(svg.hasPointerCapture(event.pointerId))pointAt(event);
 };
 svg.onkeydown=event=>{
  const next={ArrowLeft:current-1,ArrowDown:current-1,ArrowRight:current+1,ArrowUp:current+1,Home:0,End:points.length-1}[event.key];
  if(next===undefined)return;
  event.preventDefault();select(Math.max(0,Math.min(points.length-1,next)));
 };
 select(points.length-1);
}
