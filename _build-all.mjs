import { FigmaClient } from './src/core/figma-client.js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parseJSX } from './src/core/operations.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const client = new FigmaClient();
await client.connect();
const opsSrc = readFileSync(join(__dirname, 'src', 'core', 'operations.js'), 'utf8');
const rm = opsSrc.match(/const RENDERER = \x60([\s\S]*?)\x60;/);
const RENDERER = rm ? rm[1] : '';

// === PHASE 1 — Clean slate ===
console.log("P1",JSON.stringify(await client.run(`(async()=>{
var C=figma.variables;var cols=await C.getLocalVariableCollectionsAsync();var ts=new Set(["primitives","semantic","component"]);
for(var ci=0;ci<cols.length;ci++){if(ts.has(cols[ci].name)){var allV=await C.getLocalVariablesAsync();
for(var vi=0;vi<allV.length;vi++){if(allV[vi].variableCollectionId===cols[ci].id)allV[vi].remove();}cols[ci].remove();}}
var ss=figma.getLocalTextStyles();for(var si=0;si<ss.length;si++)ss[si].remove();
var demo=new Set(["Demo/Button","Demo/Card","Demo/Nav"]);var tr=[];
(function w(n){if((n.type==="COMPONENT_SET"||n.type==="COMPONENT")&&demo.has(n.name))tr.push(n);
if("children"in n){for(var i=0;i<n.children.length;i++)w(n.children[i]);}})(figma.root);
for(var i=0;i<tr.length;i++)tr[i].remove();return"ok";})()`)));

// === PHASE 2 — Primitives (COLOR, FLOAT, STRING) ===
console.log("P2",JSON.stringify(await client.run(`(async()=>{
var col=await _oc.ensureCollection("primitives");var mode=col.modes[0].modeId;
var h2r=(h)=>{return{r:parseInt(h.substring(1,3),16)/255,g:parseInt(h.substring(3,5),16)/255,b:parseInt(h.substring(5,7),16)/255}};
var mc=async function(n,h){var v=await _oc.ensureVariable(col,n,"COLOR");v.setValueForMode(mode,h2r(h));};
var mf=async function(n,vv){var v=await _oc.ensureVariable(col,n,"FLOAT");v.setValueForMode(mode,vv);};
var ms=async function(n,vv){var v=await _oc.ensureVariable(col,n,"STRING");v.setValueForMode(mode,vv);};
await mc("color/neutral/0","#FFFFFF");await mc("color/neutral/100","#F3F4F6");
await mc("color/neutral/200","#E5E7EB");await mc("color/neutral/400","#9CA3AF");
await mc("color/neutral/600","#374151");await mc("color/neutral/900","#030712");
await mc("color/brand/500","#5B21B6");await mc("color/brand/700","#6D28D9");
await mc("color/success/500","#22C55E");await mc("color/warning/500","#F59E0B");
await mc("color/danger/500","#EF4444");await mc("color/danger/700","#B91C1C");
await mf("spacing/4",4);await mf("spacing/8",8);await mf("spacing/12",12);
await mf("spacing/16",16);await mf("spacing/20",20);await mf("spacing/24",24);
await mf("spacing/32",32);await mf("spacing/40",40);
await mf("radius/4",4);await mf("radius/8",8);await mf("radius/12",12);
await mf("font-size/12",12);await mf("font-size/14",14);await mf("font-size/16",16);
await mf("font-size/18",18);await mf("font-size/24",24);await mf("font-size/32",32);
await mf("line-height/16",16);await mf("line-height/20",20);await mf("line-height/24",24);
await mf("line-height/28",28);await mf("line-height/32",32);await mf("line-height/40",40);await mf("line-height/48",48);
await mf("font-weight/regular",400);await mf("font-weight/medium",500);await mf("font-weight/semibold",600);await mf("font-weight/bold",700);
await mf("stroke-weight/1",1);await mf("stroke-weight/2",2);
await mf("opacity/50",50);await mf("opacity/80",80);await mf("opacity/100",100);
await ms("font-family/primary","Inter");await ms("font-style/normal","Normal");
return"primitives done";})()`)));

// === PHASE 3 — Semantic tokens (second-level aliases) ===
console.log("P3",JSON.stringify(await client.run(`(async()=>{
var allV=await figma.variables.getLocalVariablesAsync();
var fv=function(n,t){for(var i=0;i<allV.length;i++){if(allV[i].name===n&&allV[i].resolvedType===t)return allV[i];}return null;};
var sc=await _oc.ensureCollection("semantic");var sm=sc.modes[0].modeId;
var ac=async function(sn,pn){var src=fv(pn,"COLOR");if(!src)throw new Error("Missing "+pn);var v=await _oc.ensureVariable(sc,sn,"COLOR");v.setValueForMode(sm,{type:"VARIABLE_ALIAS",id:src.id});};
var af=async function(sn,pn){var src=fv(pn,"FLOAT");if(!src)throw new Error("Missing "+pn);var v=await _oc.ensureVariable(sc,sn,"FLOAT");v.setValueForMode(sm,{type:"VARIABLE_ALIAS",id:src.id});};
var as=async function(sn,pn){var src=fv(pn,"STRING");if(!src)throw new Error("Missing "+pn);var v=await _oc.ensureVariable(sc,sn,"STRING");v.setValueForMode(sm,{type:"VARIABLE_ALIAS",id:src.id});};
await ac("surface/bg","color/neutral/0");await ac("surface/fg","color/neutral/900");await ac("surface/muted","color/neutral/400");
await ac("action/bg","color/brand/500");await ac("action/fg","color/neutral/0");await ac("action/hover","color/brand/700");
await ac("status/error","color/danger/500");await ac("status/success","color/success/500");await ac("status/warning","color/warning/500");
await ac("border/default","color/neutral/200");await ac("border/strong","color/neutral/400");
await af("type/size/body","font-size/14");await af("type/size/h1","font-size/32");await af("type/size/h2","font-size/24");await af("type/size/caption","font-size/12");
await af("type/leading/body","line-height/20");await af("type/leading/h1","line-height/40");await af("type/leading/h2","line-height/32");await af("type/leading/caption","line-height/16");
await af("type/weight/body","font-weight/regular");await af("type/weight/heading","font-weight/bold");await af("type/weight/label","font-weight/medium");
await as("type/family/default","font-family/primary");await as("type/style/default","font-style/normal");
await af("space/xs","spacing/4");await af("space/sm","spacing/8");await af("space/md","spacing/16");await af("space/lg","spacing/24");await af("space/xl","spacing/32");
return"semantic done";})()`)));

// === PHASE 4 — Component-level tokens (third-level) ===
console.log("P4",JSON.stringify(await client.run(`(async()=>{
var allV=await figma.variables.getLocalVariablesAsync();
var fv=function(n,t){for(var i=0;i<allV.length;i++){if(allV[i].name===n&&allV[i].resolvedType===t)return allV[i];}return null;};
var cc=await _oc.ensureCollection("component");var sm=cc.modes[0].modeId;
var ac=async function(sn,pn){var src=fv(pn,"COLOR");if(!src)throw new Error("Missing "+pn);var v=await _oc.ensureVariable(cc,sn,"COLOR");v.setValueForMode(sm,{type:"VARIABLE_ALIAS",id:src.id});};
var af=async function(sn,pn){var src=fv(pn,"FLOAT");if(!src)throw new Error("Missing "+pn);var v=await _oc.ensureVariable(cc,sn,"FLOAT");v.setValueForMode(sm,{type:"VARIABLE_ALIAS",id:src.id});};
var as=async function(sn,pn){var src=fv(pn,"STRING");if(!src)throw new Error("Missing "+pn);var v=await _oc.ensureVariable(cc,sn,"STRING");v.setValueForMode(sm,{type:"VARIABLE_ALIAS",id:src.id});};
await ac("button/bg","action/bg");await ac("button/fg","action/fg");
await af("button/radius","radius/8");await af("button/gap","space/sm");await af("button/px","space/md");await af("button/py","space/xs");
await af("button/font-size","type/size/body");await as("button/font-family","type/family/default");
await ac("card/bg","surface/bg");await ac("card/fg","surface/fg");await ac("card/muted","surface/muted");await ac("card/border","border/default");
await af("card/radius","radius/8");await af("card/px","space/lg");await af("card/py","space/lg");await af("card/gap","space/sm");await af("card/stroke","stroke-weight/1");
await af("card/title-size","type/size/h2");await af("card/body-size","type/size/body");
await ac("nav/bg","surface/bg");await ac("nav/fg","surface/fg");await ac("nav/active","action/bg");await ac("nav/border","border/default");
await af("nav/px","space/lg");await af("nav/gap","space/md");await af("nav/radius","radius/4");
await af("nav/logo-size","type/size/h2");await af("nav/link-size","type/size/body");
return"component tokens done";})()`)));

// === PHASE 5 — Figma text styles with variable bindings ===
console.log("P5",JSON.stringify(await client.run(`(async()=>{
var allV=await figma.variables.getLocalVariablesAsync();
var f=function(n,t){for(var i=0;i<allV.length;i++){if(allV[i].name===n&&allV[i].resolvedType===t)return allV[i];}return null;};
var ss=[
  {n:"Heading/1",s:"type/size/h1",l:"type/leading/h1",w:"type/weight/heading",fam:"type/family/default",sty:"type/style/default",fs:32,fn:{family:"Inter",style:"Bold"},lh:{unit:"PIXELS",value:40}},
  {n:"Heading/2",s:"type/size/h2",l:"type/leading/h2",w:"type/weight/heading",fam:"type/family/default",sty:"type/style/default",fs:24,fn:{family:"Inter",style:"Bold"},lh:{unit:"PIXELS",value:32}},
  {n:"Body",s:"type/size/body",l:"type/leading/body",w:"type/weight/body",fam:"type/family/default",sty:"type/style/default",fs:14,fn:{family:"Inter",style:"Regular"},lh:{unit:"PIXELS",value:20}},
  {n:"Caption",s:"type/size/caption",l:"type/leading/caption",w:"type/weight/body",fam:"type/family/default",sty:"type/style/default",fs:12,fn:{family:"Inter",style:"Regular"},lh:{unit:"PIXELS",value:16}},
  {n:"Label",s:"type/size/body",l:"type/leading/body",w:"type/weight/label",fam:"type/family/default",sty:"type/style/default",fs:14,fn:{family:"Inter",style:"Medium"},lh:{unit:"PIXELS",value:20}}
];
for(var si=0;si<ss.length;si++){var c=ss[si];var st=figma.createTextStyle();
st.name=c.n;st.fontSize=c.fs;st.fontName=c.fn;st.lineHeight=c.lh;
try{var vS=f(c.s,"FLOAT");if(vS)st.setBoundVariable("fontSize",vS);
var vL=f(c.l,"FLOAT");if(vL)st.setBoundVariable("lineHeight",vL);
var vW=f(c.w,"FLOAT");if(vW)st.setBoundVariable("fontWeight",vW);
var vFam=f(c.fam,"STRING");if(vFam)st.setBoundVariable("fontFamily",vFam);
var vSty=f(c.sty,"STRING");if(vSty)st.setBoundVariable("fontStyle",vSty);
}catch(e){}}return"text styles done";})()`)));

// === PHASE 6 — Figma color styles ===
console.log("P6",JSON.stringify(await client.run(`(async()=>{
var allV=await figma.variables.getLocalVariablesAsync();
var fv=function(n,t){for(var i=0;i<allV.length;i++){if(allV[i].name===n&&allV[i].resolvedType===t)return allV[i];}return null;};
var cs=[{n:"Surface/Background",v:"surface/bg"},{n:"Surface/Foreground",v:"surface/fg"},{n:"Action/Primary",v:"action/bg"},{n:"Border/Default",v:"border/default"},{n:"Status/Error",v:"status/error"},{n:"Status/Success",v:"status/success"}];
for(var si=0;si<cs.length;si++){var c=cs[si];var v=fv(c.v,"COLOR");if(!v)continue;var ps=figma.createPaintStyle();
ps.name=c.n;ps.paints=[figma.variables.setBoundVariableForPaint({type:"SOLID",color:{r:0.5,g:0.5,b:0.5}},"color",v)];}
return"color styles done";})()`)));

// === PHASE 7 — Demo/Button (45 variants) ===
var states=["Default","Hover","Disabled"],sizes=["Sm","Md","Lg"],types=["Primary","Secondary","Outline","Ghost","Danger"];
var btnVars=[];
for(var si=0;si<states.length;si++){for(var zi=0;zi<sizes.length;zi++){for(var ti=0;ti<types.length;ti++){
var s=states[si],z=sizes[zi],t=types[ti];
var sz=(z==='Sm'?'sm':z==='Md'?'md':'lg');
var w=(z==='Lg'?'semibold':'medium');
var isH=(s==='Hover'),isD=(s==='Disabled');
var jsx='<Frame name="Btn" flex="row" gap={"var:component/button/gap"} px={"var:component/button/px"} py={"var:component/button/py"} rounded={"var:component/button/radius"} justify="center" items="center" bg="var:component/button/bg" opacity={'+(isH?'"var:component/button/opacity/hover"':isD?'"var:component/button/opacity/disabled"':'1')+'}><Text name="Label" size={"var:component/button/font-size"} weight="'+w+'" color="var:component/button/fg">'+t+'</Text></Frame>';
btnVars.push({tree:parseJSX(jsx)[0],name:'State='+s+', Size='+z+', Type='+t});
}}}
console.log("P7",JSON.stringify(await client.run(`(async()=>{

const TEXT_TAGS = new Set(['text','span','p','h1','h2','h3','h4','label']);
const FRAME_TAGS = new Set(['frame','group','box','div','stack','vstack','hstack','row','col','column']);

const renderTree = async (tree, parent) => {
  const { tag, props, children } = tree;
  const t = String(tag).toLowerCase();
  let node;
  let isInstance = false;

  if (FRAME_TAGS.has(t)) {
    node = figma.createFrame();
    node.fills = [];
  } else if (t === 'rect' || t === 'rectangle') {
    node = figma.createRectangle();
  } else if (t === 'ellipse' || t === 'circle') {
    node = figma.createEllipse();
  } else if (TEXT_TAGS.has(t)) {
    const fontFamily = props.font || 'Inter';
    const weight = props.weight;
    const styleMap = {
      bold: 'Bold',
      medium: 'Medium',
      semibold: 'Semi Bold',
      'semi-bold': 'Semi Bold',
      light: 'Light',
      regular: 'Regular'
    };
    const style = weight ? (styleMap[String(weight).toLowerCase()] || 'Regular') : 'Regular';
    const f = await _oc.loadFont(fontFamily, style);
    node = figma.createText();
    node.fontName = f;
    const text = (children || []).find(c => typeof c === 'string') || '';
    node.characters = text;
    if (props.size != null) await _oc.applyScalarBinding(node, 'fontSize', props.size);
    else if (t === 'h1') node.fontSize = 32;
    else if (t === 'h2') node.fontSize = 24;
    else if (t === 'h3') node.fontSize = 18;
    else if (t === 'h4') node.fontSize = 16;
    if (props.color != null) await _oc.applyFill(node, props.color);
  } else if (t === 'instance') {
    if (!props.component) throw new Error('<Instance> requires a "component" prop');
    const overrides = {};
    for (const [k, v] of Object.entries(props)) {
      if (k === 'component' || k === 'variant' || k === 'name' ||
          k === 'w' || k === 'h' || k === 'width' || k === 'height' ||
          k === 'flex' || k === 'gap' || k === 'p' || k === 'px' || k === 'py' ||
          k === 'pl' || k === 'pr' || k === 'pt' || k === 'pb' ||
          k === 'justify' || k === 'items' || k === 'opacity' ||
          k === 'bg' || k === 'fill' || k === 'stroke' || k === 'strokeWidth' || k === 'rounded') continue;
      overrides[k] = v;
    }
    const textChild = (children || []).find(c => typeof c === 'string');
    if (textChild && !overrides.Label && !overrides.label && !overrides.Text && !overrides.text) {
      overrides.Label = textChild;
    }
    node = await _oc.instantiate(props.component, { variant: props.variant, overrides });
    isInstance = true;
  } else {
    throw new Error('Unknown tag "' + tag + '". Use: Frame, Stack, HStack, VStack, Text, Rect, Ellipse, Instance');
  }

  const capTag = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : 'Frame');
  const pn = props.name;
  if (pn != null && typeof pn !== 'boolean') {
    const ns = String(pn).trim();
    if (ns) node.name = ns;
    else if (!isInstance) node.name = capTag(tag);
  } else if (!isInstance) node.name = capTag(tag);

  // Map tag aliases → flex direction (so the AI can use semantic stacks).
  let inferredFlex = props.flex;
  if (!inferredFlex) {
    if (t === 'hstack' || t === 'row') inferredFlex = 'row';
    else if (t === 'vstack' || t === 'col' || t === 'column' || t === 'stack') inferredFlex = 'col';
  }

  if (inferredFlex && 'layoutMode' in node && node.type !== 'INSTANCE') {
    node.layoutMode = inferredFlex === 'row' ? 'HORIZONTAL' : 'VERTICAL';
    if (props.gap != null) await _oc.applyScalarBinding(node, 'itemSpacing', props.gap);
    if (props.p != null) {
      await _oc.applyScalarBinding(node, 'paddingLeft', props.p);
      await _oc.applyScalarBinding(node, 'paddingRight', props.p);
      await _oc.applyScalarBinding(node, 'paddingTop', props.p);
      await _oc.applyScalarBinding(node, 'paddingBottom', props.p);
    }
    if (props.px != null) {
      await _oc.applyScalarBinding(node, 'paddingLeft', props.px);
      await _oc.applyScalarBinding(node, 'paddingRight', props.px);
    }
    if (props.py != null) {
      await _oc.applyScalarBinding(node, 'paddingTop', props.py);
      await _oc.applyScalarBinding(node, 'paddingBottom', props.py);
    }
    if (props.pl != null) await _oc.applyScalarBinding(node, 'paddingLeft', props.pl);
    if (props.pr != null) await _oc.applyScalarBinding(node, 'paddingRight', props.pr);
    if (props.pt != null) await _oc.applyScalarBinding(node, 'paddingTop', props.pt);
    if (props.pb != null) await _oc.applyScalarBinding(node, 'paddingBottom', props.pb);

    const align = { start: 'MIN', center: 'CENTER', end: 'MAX', between: 'SPACE_BETWEEN' };
    if (props.justify && align[props.justify]) node.primaryAxisAlignItems = align[props.justify];
    if (props.items && align[props.items]) node.counterAxisAlignItems = align[props.items];

    // Default to HUG so frames don't get clipped to their initial 100×100.
    if ('primaryAxisSizingMode' in node) node.primaryAxisSizingMode = 'AUTO';
    if ('counterAxisSizingMode' in node) node.counterAxisSizingMode = 'AUTO';
  }

  let w = props.w != null ? props.w : props.width;
  let h = props.h != null ? props.h : props.height;
  const fillW = w === 'fill' || w === '100%';
  const fillH = h === 'fill' || h === '100%';
  const hugW = w === 'hug' || w === 'auto';
  const hugH = h === 'hug' || h === 'auto';
  if (fillW || hugW) w = null;
  if (fillH || hugH) h = null;

  if (typeof node.resize === 'function' && (w != null || h != null) && node.type !== 'INSTANCE') {
    const W = w != null ? Number(w) : (node.width || 100);
    const H = h != null ? Number(h) : (node.height || 100);
    if (W > 0 && H > 0) node.resize(W, H);
  }

  if (parent) parent.appendChild(node);

  // Apply layout sizing hints (FILL / HUG) once the node has a parent that supports auto-layout.
  if (parent && parent.layoutMode && parent.layoutMode !== 'NONE') {
    if (fillW && 'layoutSizingHorizontal' in node) node.layoutSizingHorizontal = 'FILL';
    else if (hugW && 'layoutSizingHorizontal' in node) node.layoutSizingHorizontal = 'HUG';
    if (fillH && 'layoutSizingVertical' in node) node.layoutSizingVertical = 'FILL';
    else if (hugH && 'layoutSizingVertical' in node) node.layoutSizingVertical = 'HUG';
  }

  if (!isInstance) {
    if (props.bg != null && !TEXT_TAGS.has(t)) await _oc.applyFill(node, props.bg);
    if (props.fill != null && !TEXT_TAGS.has(t)) await _oc.applyFill(node, props.fill);
    if (props.stroke != null) {
      const sw = props.strokeWidth != null && props.strokeWidth !== '' ? props.strokeWidth : 1;
      await _oc.applyStroke(node, props.stroke, sw);
    } else if (props.strokeWidth != null && props.strokeWidth !== '') {
      await _oc.applyScalarBinding(node, 'strokeWeight', props.strokeWidth);
    }
    if (props.rounded != null && 'cornerRadius' in node) await _oc.applyScalarBinding(node, 'cornerRadius', props.rounded);
  }
  if (props.opacity != null) await _oc.applyScalarBinding(node, 'opacity', props.opacity);

  if (!isInstance && !TEXT_TAGS.has(t) && children) {
    for (const c of children) {
      if (typeof c === 'string') continue;
      await renderTree(c, node);
    }
  }
  return node;
};

await figma.loadFontAsync({family:"Inter",style:"Regular"});
await figma.loadFontAsync({family:"Inter",style:"Medium"});
await figma.loadFontAsync({family:"Inter",style:"Semi Bold"});await figma.loadFontAsync({family:"Inter",style:"Bold"});
var comps=[];for(var vi=0;vi<ctx.vs.length;vi++){var tree=ctx.vs[vi].tree;var node=await renderTree(tree,null);
figma.currentPage.appendChild(node);var c=figma.createComponentFromNode(node);c.name=ctx.vs[vi].name;comps.push(c);}
var set=figma.combineAsVariants(comps,figma.currentPage);set.name="Demo/Button";
set.layoutMode="HORIZONTAL";set.itemSpacing=24;
set.paddingLeft=set.paddingRight=set.paddingTop=set.paddingBottom=24;
set.primaryAxisSizingMode="AUTO";set.counterAxisSizingMode="AUTO";
figma.viewport.scrollAndZoomIntoView([set]);
return{id:set.id,name:set.name,count:comps.length};})()`,{vs:btnVars})));

// === PHASE 8 — Demo/Card (9 variants) ===
var sz2=['Sm','Md','Lg'];var st2=['Default','Image','Icon'];
var cVars=[];var wids={Sm:260,Md:340,Lg:420};var ih={Sm:80,Md:120,Lg:160};var iz={Sm:36,Md:48,Lg:56};
for(var si=0;si<st2.length;si++){for(var zi=0;zi<sz2.length;zi++){var sk=st2[si],zk=sz2[zi];var ch=[];
if(sk==='Image'){ch.push('<Frame name="Image" w="fill" h={'+ih[zk]+'} rounded={"var:component/card/radius"} bg="var:component/card/border"/>');}
if(sk==='Icon'){ch.push('<Frame name="Icon" w={'+iz[zk]+'} h={'+iz[zk]+'} rounded={'+(iz[zk]/2)+'} bg="var:component/card/border"/>');}
ch.push('<Text name="Title" size={"var:component/card/title-size"} weight="bold" color="var:component/card/fg">Card</Text>');
ch.push('<Text name="Body" size={"var:component/card/body-size"} color="var:component/card/muted">Description</Text>');
ch.push('<Instance name="Action" component="Demo/Button" variant="State=Default, Size='+zk+', Type=Primary" Label="Go"/>');
var jsx='<Frame name="Card" flex="col" w={'+wids[zk]+'} gap={"var:component/card/gap"} px={"var:component/card/px"} py={"var:component/card/py"} bg="var:component/card/bg" rounded={"var:component/card/radius"} stroke="var:component/card/border" strokeWidth={"var:component/card/stroke"}>'+ch.join('')+'</Frame>';
cVars.push({tree:parseJSX(jsx)[0],name:'Size='+zk+', Style='+sk});}}
console.log("P8",JSON.stringify(await client.run(`(async()=>{

const TEXT_TAGS = new Set(['text','span','p','h1','h2','h3','h4','label']);
const FRAME_TAGS = new Set(['frame','group','box','div','stack','vstack','hstack','row','col','column']);

const renderTree = async (tree, parent) => {
  const { tag, props, children } = tree;
  const t = String(tag).toLowerCase();
  let node;
  let isInstance = false;

  if (FRAME_TAGS.has(t)) {
    node = figma.createFrame();
    node.fills = [];
  } else if (t === 'rect' || t === 'rectangle') {
    node = figma.createRectangle();
  } else if (t === 'ellipse' || t === 'circle') {
    node = figma.createEllipse();
  } else if (TEXT_TAGS.has(t)) {
    const fontFamily = props.font || 'Inter';
    const weight = props.weight;
    const styleMap = {
      bold: 'Bold',
      medium: 'Medium',
      semibold: 'Semi Bold',
      'semi-bold': 'Semi Bold',
      light: 'Light',
      regular: 'Regular'
    };
    const style = weight ? (styleMap[String(weight).toLowerCase()] || 'Regular') : 'Regular';
    const f = await _oc.loadFont(fontFamily, style);
    node = figma.createText();
    node.fontName = f;
    const text = (children || []).find(c => typeof c === 'string') || '';
    node.characters = text;
    if (props.size != null) await _oc.applyScalarBinding(node, 'fontSize', props.size);
    else if (t === 'h1') node.fontSize = 32;
    else if (t === 'h2') node.fontSize = 24;
    else if (t === 'h3') node.fontSize = 18;
    else if (t === 'h4') node.fontSize = 16;
    if (props.color != null) await _oc.applyFill(node, props.color);
  } else if (t === 'instance') {
    if (!props.component) throw new Error('<Instance> requires a "component" prop');
    const overrides = {};
    for (const [k, v] of Object.entries(props)) {
      if (k === 'component' || k === 'variant' || k === 'name' ||
          k === 'w' || k === 'h' || k === 'width' || k === 'height' ||
          k === 'flex' || k === 'gap' || k === 'p' || k === 'px' || k === 'py' ||
          k === 'pl' || k === 'pr' || k === 'pt' || k === 'pb' ||
          k === 'justify' || k === 'items' || k === 'opacity' ||
          k === 'bg' || k === 'fill' || k === 'stroke' || k === 'strokeWidth' || k === 'rounded') continue;
      overrides[k] = v;
    }
    const textChild = (children || []).find(c => typeof c === 'string');
    if (textChild && !overrides.Label && !overrides.label && !overrides.Text && !overrides.text) {
      overrides.Label = textChild;
    }
    node = await _oc.instantiate(props.component, { variant: props.variant, overrides });
    isInstance = true;
  } else {
    throw new Error('Unknown tag "' + tag + '". Use: Frame, Stack, HStack, VStack, Text, Rect, Ellipse, Instance');
  }

  const capTag = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : 'Frame');
  const pn = props.name;
  if (pn != null && typeof pn !== 'boolean') {
    const ns = String(pn).trim();
    if (ns) node.name = ns;
    else if (!isInstance) node.name = capTag(tag);
  } else if (!isInstance) node.name = capTag(tag);

  // Map tag aliases → flex direction (so the AI can use semantic stacks).
  let inferredFlex = props.flex;
  if (!inferredFlex) {
    if (t === 'hstack' || t === 'row') inferredFlex = 'row';
    else if (t === 'vstack' || t === 'col' || t === 'column' || t === 'stack') inferredFlex = 'col';
  }

  if (inferredFlex && 'layoutMode' in node && node.type !== 'INSTANCE') {
    node.layoutMode = inferredFlex === 'row' ? 'HORIZONTAL' : 'VERTICAL';
    if (props.gap != null) await _oc.applyScalarBinding(node, 'itemSpacing', props.gap);
    if (props.p != null) {
      await _oc.applyScalarBinding(node, 'paddingLeft', props.p);
      await _oc.applyScalarBinding(node, 'paddingRight', props.p);
      await _oc.applyScalarBinding(node, 'paddingTop', props.p);
      await _oc.applyScalarBinding(node, 'paddingBottom', props.p);
    }
    if (props.px != null) {
      await _oc.applyScalarBinding(node, 'paddingLeft', props.px);
      await _oc.applyScalarBinding(node, 'paddingRight', props.px);
    }
    if (props.py != null) {
      await _oc.applyScalarBinding(node, 'paddingTop', props.py);
      await _oc.applyScalarBinding(node, 'paddingBottom', props.py);
    }
    if (props.pl != null) await _oc.applyScalarBinding(node, 'paddingLeft', props.pl);
    if (props.pr != null) await _oc.applyScalarBinding(node, 'paddingRight', props.pr);
    if (props.pt != null) await _oc.applyScalarBinding(node, 'paddingTop', props.pt);
    if (props.pb != null) await _oc.applyScalarBinding(node, 'paddingBottom', props.pb);

    const align = { start: 'MIN', center: 'CENTER', end: 'MAX', between: 'SPACE_BETWEEN' };
    if (props.justify && align[props.justify]) node.primaryAxisAlignItems = align[props.justify];
    if (props.items && align[props.items]) node.counterAxisAlignItems = align[props.items];

    // Default to HUG so frames don't get clipped to their initial 100×100.
    if ('primaryAxisSizingMode' in node) node.primaryAxisSizingMode = 'AUTO';
    if ('counterAxisSizingMode' in node) node.counterAxisSizingMode = 'AUTO';
  }

  let w = props.w != null ? props.w : props.width;
  let h = props.h != null ? props.h : props.height;
  const fillW = w === 'fill' || w === '100%';
  const fillH = h === 'fill' || h === '100%';
  const hugW = w === 'hug' || w === 'auto';
  const hugH = h === 'hug' || h === 'auto';
  if (fillW || hugW) w = null;
  if (fillH || hugH) h = null;

  if (typeof node.resize === 'function' && (w != null || h != null) && node.type !== 'INSTANCE') {
    const W = w != null ? Number(w) : (node.width || 100);
    const H = h != null ? Number(h) : (node.height || 100);
    if (W > 0 && H > 0) node.resize(W, H);
  }

  if (parent) parent.appendChild(node);

  // Apply layout sizing hints (FILL / HUG) once the node has a parent that supports auto-layout.
  if (parent && parent.layoutMode && parent.layoutMode !== 'NONE') {
    if (fillW && 'layoutSizingHorizontal' in node) node.layoutSizingHorizontal = 'FILL';
    else if (hugW && 'layoutSizingHorizontal' in node) node.layoutSizingHorizontal = 'HUG';
    if (fillH && 'layoutSizingVertical' in node) node.layoutSizingVertical = 'FILL';
    else if (hugH && 'layoutSizingVertical' in node) node.layoutSizingVertical = 'HUG';
  }

  if (!isInstance) {
    if (props.bg != null && !TEXT_TAGS.has(t)) await _oc.applyFill(node, props.bg);
    if (props.fill != null && !TEXT_TAGS.has(t)) await _oc.applyFill(node, props.fill);
    if (props.stroke != null) {
      const sw = props.strokeWidth != null && props.strokeWidth !== '' ? props.strokeWidth : 1;
      await _oc.applyStroke(node, props.stroke, sw);
    } else if (props.strokeWidth != null && props.strokeWidth !== '') {
      await _oc.applyScalarBinding(node, 'strokeWeight', props.strokeWidth);
    }
    if (props.rounded != null && 'cornerRadius' in node) await _oc.applyScalarBinding(node, 'cornerRadius', props.rounded);
  }
  if (props.opacity != null) await _oc.applyScalarBinding(node, 'opacity', props.opacity);

  if (!isInstance && !TEXT_TAGS.has(t) && children) {
    for (const c of children) {
      if (typeof c === 'string') continue;
      await renderTree(c, node);
    }
  }
  return node;
};

await figma.loadFontAsync({family:"Inter",style:"Regular"});await figma.loadFontAsync({family:"Inter",style:"Medium"});await figma.loadFontAsync({family:"Inter",style:"Semi Bold"});await figma.loadFontAsync({family:"Inter",style:"Bold"});
var comps=[];for(var vi=0;vi<ctx.vs.length;vi++){var tree=ctx.vs[vi].tree;var node=await renderTree(tree,null);
figma.currentPage.appendChild(node);var c=figma.createComponentFromNode(node);c.name=ctx.vs[vi].name;comps.push(c);}
var set=figma.combineAsVariants(comps,figma.currentPage);set.name="Demo/Card";
set.layoutMode="HORIZONTAL";set.itemSpacing=40;
set.paddingLeft=set.paddingRight=set.paddingTop=set.paddingBottom=40;
set.primaryAxisSizingMode="AUTO";set.counterAxisSizingMode="AUTO";
figma.viewport.scrollAndZoomIntoView([set]);
return{id:set.id,name:set.name,count:comps.length};})()`,{vs:cVars})));

// === PHASE 9 — Demo/Nav (2 variants) ===
var dJSX='<Frame name="Nav" flex="row" w="fill" h={64} px={"var:component/nav/px"} bg="var:component/nav/bg" stroke="var:component/nav/border" strokeWidth={1} items="center" gap={"var:component/nav/gap"}>'
+'<Frame name="Logo" flex="row" gap={"var:component/nav/radius"} items="center"><Frame name="LogoIcon" w={32} h={32} rounded={"var:component/nav/radius"} bg="var:component/nav/active"/><Text name="LogoText" size={"var:component/nav/logo-size"} weight="bold" color="var:component/nav/fg">Brand</Text></Frame>'
+'<Frame name="Links" flex="row" gap={"var:component/nav/gap"} items="center"><Text name="Link1" size={"var:component/nav/link-size"} weight="medium" color="var:component/nav/active">Home</Text><Text name="Link2" size={"var:component/nav/link-size"} weight="medium" color="var:component/nav/fg">Products</Text><Text name="Link3" size={"var:component/nav/link-size"} weight="medium" color="var:component/nav/fg">About</Text></Frame>'
+'<Instance name="CTA" component="Demo/Button" variant="State=Default, Size=Sm, Type=Primary" Label="Get Started"/></Frame>';
var mJSX='<Frame name="Nav" flex="row" w="fill" h={56} px={16} bg="var:component/nav/bg" stroke="var:component/nav/border" strokeWidth={1} items="center">'
+'<Frame name="Logo" flex="row" gap={"var:component/nav/radius"} items="center"><Frame name="LogoIcon" w={28} h={28} rounded={6} bg="var:component/nav/active"/><Text name="LogoText" size={16} weight="bold" color="var:component/nav/fg">Brand</Text></Frame>'
+'<Frame name="Spacer" w="fill"/><Frame name="Hamburger" w={24} h={24} flex="col" gap={4} items="center" justify="center"><Rect name="L1" w={20} h={2} rounded={1} bg="var:component/nav/fg"/><Rect name="L2" w={20} h={2} rounded={1} bg="var:component/nav/fg"/><Rect name="L3" w={20} h={2} rounded={1} bg="var:component/nav/fg"/></Frame></Frame>';
console.log("P9",JSON.stringify(await client.run(`(async()=>{

const TEXT_TAGS = new Set(['text','span','p','h1','h2','h3','h4','label']);
const FRAME_TAGS = new Set(['frame','group','box','div','stack','vstack','hstack','row','col','column']);

const renderTree = async (tree, parent) => {
  const { tag, props, children } = tree;
  const t = String(tag).toLowerCase();
  let node;
  let isInstance = false;

  if (FRAME_TAGS.has(t)) {
    node = figma.createFrame();
    node.fills = [];
  } else if (t === 'rect' || t === 'rectangle') {
    node = figma.createRectangle();
  } else if (t === 'ellipse' || t === 'circle') {
    node = figma.createEllipse();
  } else if (TEXT_TAGS.has(t)) {
    const fontFamily = props.font || 'Inter';
    const weight = props.weight;
    const styleMap = {
      bold: 'Bold',
      medium: 'Medium',
      semibold: 'Semi Bold',
      'semi-bold': 'Semi Bold',
      light: 'Light',
      regular: 'Regular'
    };
    const style = weight ? (styleMap[String(weight).toLowerCase()] || 'Regular') : 'Regular';
    const f = await _oc.loadFont(fontFamily, style);
    node = figma.createText();
    node.fontName = f;
    const text = (children || []).find(c => typeof c === 'string') || '';
    node.characters = text;
    if (props.size != null) await _oc.applyScalarBinding(node, 'fontSize', props.size);
    else if (t === 'h1') node.fontSize = 32;
    else if (t === 'h2') node.fontSize = 24;
    else if (t === 'h3') node.fontSize = 18;
    else if (t === 'h4') node.fontSize = 16;
    if (props.color != null) await _oc.applyFill(node, props.color);
  } else if (t === 'instance') {
    if (!props.component) throw new Error('<Instance> requires a "component" prop');
    const overrides = {};
    for (const [k, v] of Object.entries(props)) {
      if (k === 'component' || k === 'variant' || k === 'name' ||
          k === 'w' || k === 'h' || k === 'width' || k === 'height' ||
          k === 'flex' || k === 'gap' || k === 'p' || k === 'px' || k === 'py' ||
          k === 'pl' || k === 'pr' || k === 'pt' || k === 'pb' ||
          k === 'justify' || k === 'items' || k === 'opacity' ||
          k === 'bg' || k === 'fill' || k === 'stroke' || k === 'strokeWidth' || k === 'rounded') continue;
      overrides[k] = v;
    }
    const textChild = (children || []).find(c => typeof c === 'string');
    if (textChild && !overrides.Label && !overrides.label && !overrides.Text && !overrides.text) {
      overrides.Label = textChild;
    }
    node = await _oc.instantiate(props.component, { variant: props.variant, overrides });
    isInstance = true;
  } else {
    throw new Error('Unknown tag "' + tag + '". Use: Frame, Stack, HStack, VStack, Text, Rect, Ellipse, Instance');
  }

  const capTag = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : 'Frame');
  const pn = props.name;
  if (pn != null && typeof pn !== 'boolean') {
    const ns = String(pn).trim();
    if (ns) node.name = ns;
    else if (!isInstance) node.name = capTag(tag);
  } else if (!isInstance) node.name = capTag(tag);

  // Map tag aliases → flex direction (so the AI can use semantic stacks).
  let inferredFlex = props.flex;
  if (!inferredFlex) {
    if (t === 'hstack' || t === 'row') inferredFlex = 'row';
    else if (t === 'vstack' || t === 'col' || t === 'column' || t === 'stack') inferredFlex = 'col';
  }

  if (inferredFlex && 'layoutMode' in node && node.type !== 'INSTANCE') {
    node.layoutMode = inferredFlex === 'row' ? 'HORIZONTAL' : 'VERTICAL';
    if (props.gap != null) await _oc.applyScalarBinding(node, 'itemSpacing', props.gap);
    if (props.p != null) {
      await _oc.applyScalarBinding(node, 'paddingLeft', props.p);
      await _oc.applyScalarBinding(node, 'paddingRight', props.p);
      await _oc.applyScalarBinding(node, 'paddingTop', props.p);
      await _oc.applyScalarBinding(node, 'paddingBottom', props.p);
    }
    if (props.px != null) {
      await _oc.applyScalarBinding(node, 'paddingLeft', props.px);
      await _oc.applyScalarBinding(node, 'paddingRight', props.px);
    }
    if (props.py != null) {
      await _oc.applyScalarBinding(node, 'paddingTop', props.py);
      await _oc.applyScalarBinding(node, 'paddingBottom', props.py);
    }
    if (props.pl != null) await _oc.applyScalarBinding(node, 'paddingLeft', props.pl);
    if (props.pr != null) await _oc.applyScalarBinding(node, 'paddingRight', props.pr);
    if (props.pt != null) await _oc.applyScalarBinding(node, 'paddingTop', props.pt);
    if (props.pb != null) await _oc.applyScalarBinding(node, 'paddingBottom', props.pb);

    const align = { start: 'MIN', center: 'CENTER', end: 'MAX', between: 'SPACE_BETWEEN' };
    if (props.justify && align[props.justify]) node.primaryAxisAlignItems = align[props.justify];
    if (props.items && align[props.items]) node.counterAxisAlignItems = align[props.items];

    // Default to HUG so frames don't get clipped to their initial 100×100.
    if ('primaryAxisSizingMode' in node) node.primaryAxisSizingMode = 'AUTO';
    if ('counterAxisSizingMode' in node) node.counterAxisSizingMode = 'AUTO';
  }

  let w = props.w != null ? props.w : props.width;
  let h = props.h != null ? props.h : props.height;
  const fillW = w === 'fill' || w === '100%';
  const fillH = h === 'fill' || h === '100%';
  const hugW = w === 'hug' || w === 'auto';
  const hugH = h === 'hug' || h === 'auto';
  if (fillW || hugW) w = null;
  if (fillH || hugH) h = null;

  if (typeof node.resize === 'function' && (w != null || h != null) && node.type !== 'INSTANCE') {
    const W = w != null ? Number(w) : (node.width || 100);
    const H = h != null ? Number(h) : (node.height || 100);
    if (W > 0 && H > 0) node.resize(W, H);
  }

  if (parent) parent.appendChild(node);

  // Apply layout sizing hints (FILL / HUG) once the node has a parent that supports auto-layout.
  if (parent && parent.layoutMode && parent.layoutMode !== 'NONE') {
    if (fillW && 'layoutSizingHorizontal' in node) node.layoutSizingHorizontal = 'FILL';
    else if (hugW && 'layoutSizingHorizontal' in node) node.layoutSizingHorizontal = 'HUG';
    if (fillH && 'layoutSizingVertical' in node) node.layoutSizingVertical = 'FILL';
    else if (hugH && 'layoutSizingVertical' in node) node.layoutSizingVertical = 'HUG';
  }

  if (!isInstance) {
    if (props.bg != null && !TEXT_TAGS.has(t)) await _oc.applyFill(node, props.bg);
    if (props.fill != null && !TEXT_TAGS.has(t)) await _oc.applyFill(node, props.fill);
    if (props.stroke != null) {
      const sw = props.strokeWidth != null && props.strokeWidth !== '' ? props.strokeWidth : 1;
      await _oc.applyStroke(node, props.stroke, sw);
    } else if (props.strokeWidth != null && props.strokeWidth !== '') {
      await _oc.applyScalarBinding(node, 'strokeWeight', props.strokeWidth);
    }
    if (props.rounded != null && 'cornerRadius' in node) await _oc.applyScalarBinding(node, 'cornerRadius', props.rounded);
  }
  if (props.opacity != null) await _oc.applyScalarBinding(node, 'opacity', props.opacity);

  if (!isInstance && !TEXT_TAGS.has(t) && children) {
    for (const c of children) {
      if (typeof c === 'string') continue;
      await renderTree(c, node);
    }
  }
  return node;
};

await figma.loadFontAsync({family:"Inter",style:"Regular"});await figma.loadFontAsync({family:"Inter",style:"Medium"});await figma.loadFontAsync({family:"Inter",style:"Semi Bold"});await figma.loadFontAsync({family:"Inter",style:"Bold"});
var dt=await renderTree(ctx.d, null);figma.currentPage.appendChild(dt);var c1=figma.createComponentFromNode(dt);c1.name="Type=Desktop";
var mb=await renderTree(ctx.m, null);figma.currentPage.appendChild(mb);var c2=figma.createComponentFromNode(mb);c2.name="Type=Mobile";
var set=figma.combineAsVariants([c1,c2],figma.currentPage);set.name="Demo/Nav";
set.primaryAxisSizingMode="AUTO";set.counterAxisSizingMode="AUTO";
figma.viewport.scrollAndZoomIntoView([set]);return{id:set.id,name:set.name};})()`,{d:parseJSX(dJSX)[0],m:parseJSX(mJSX)[0]})));

// === PHASE 10 — Apply text styles to all component text nodes ===
console.log("P10",JSON.stringify(await client.run(`(async()=>{
var T=figma.getLocalTextStyles();var st=function(n){for(var i=0;i<T.length;i++){if(T[i].name===n)return T[i];}return null;};
var h2=st("Heading/2");var body=st("Body");var cap=st("Caption");var lbl=st("Label");
var allV=await figma.variables.getLocalVariablesAsync();
var fv=function(n,t){for(var i=0;i<allV.length;i++){if(allV[i].name===n&&allV[i].resolvedType===t)return allV[i];}return null;};
var pb=function(vn){var v=fv(vn,"COLOR");if(!v)return[{type:"SOLID",color:{r:0,g:0,b:0}}];return[figma.variables.setBoundVariableForPaint({type:"SOLID",color:{r:0.2,g:0.2,b:0.2}},"color",v)];};
var a=0;var sets=[null,null,null];(function w(n){if(n.type==="COMPONENT_SET"){if(n.name==="Demo/Button")sets[0]=n;if(n.name==="Demo/Card")sets[1]=n;if(n.name==="Demo/Nav")sets[2]=n;}if("children"in n){for(var i=0;i<n.children.length;i++)w(n.children[i]);}})(figma.root);
for(var si=0;si<sets.length;si++){if(!sets[si])continue;
for(var ci=0;ci<sets[si].children.length;ci++){(function w2(n){if(n.type==="TEXT"){
if(n.name==="Label"){var s=n.name.indexOf("Size=Sm")>=0||sets[si].children[ci].name.indexOf("Size=Sm")>=0?cap:body;n.textStyleId=s?s.id:null;a++;}
if(n.name==="Title"&&h2){n.textStyleId=h2.id;a++}
if(n.name==="Body"&&body){n.textStyleId=body.id;a++}
if(n.name==="LogoText"&&h2){n.textStyleId=h2.id;n.fills=pb("component/nav/fg");a++}
if(n.name.indexOf("Link")===0&&lbl){n.textStyleId=lbl.id;n.fills=pb(n.name==="Link1"?"component/nav/active":"component/nav/fg");a++}
}if("children"in n){for(var i=0;i<n.children.length;i++)w2(n.children[i]);}})(sets[si].children[ci]);}}
return{applied:a};})()`)));

// === PHASE 11 — Card image fills ===
async function fb64(u){var r=await fetch(u);if(!r.ok)throw Error('Fetch fail');return Buffer.from(await r.arrayBuffer()).toString('base64');}
console.log("P11: fetching…");
var imgs=[{s:"Sm",u:"https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=260&h=80&fit=crop&auto=format"},{s:"Md",u:"https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=340&h=120&fit=crop&auto=format"},{s:"Lg",u:"https://images.unsplash.com/photo-1518531933037-91b2f5f229cc?w=420&h=160&fit=crop&auto=format"}];
for(var i=0;i<imgs.length;i++){console.log('  '+imgs[i].s);imgs[i].b64=await fb64(imgs[i].u);}
console.log("  apply",JSON.stringify(await client.run(`(async()=>{
var cs=null;(function w(n){if(n.type==="COMPONENT_SET"&&n.name==="Demo/Card")cs=n;if("children"in n){for(var i=0;i<n.children.length;i++)w(n.children[i]);}})(figma.root);
if(!cs)return{error:"not found"};var a=0;
for(var ci=0;ci<cs.children.length;ci++){var c=cs.children[ci];if(c.name.indexOf("Style=Image")===-1)continue;var d=null;for(var ii=0;ii<ctx.d.length;ii++){if(c.name.indexOf("Size="+ctx.d[ii].s)>=0){d=ctx.d[ii];break}}if(!d)continue;var ic=c.children[0];if(!ic||ic.name!=="Image")continue;var bytes=Uint8Array.from(atob(d.b64),function(ch){return ch.charCodeAt(0)});ic.fills=[{type:"IMAGE",scaleMode:"FILL",imageHash:figma.createImage(bytes).hash}];a++}
return{applied:a};})()`,{d:imgs})));

// === PHASE 12 — Card icon star chars ===
console.log("P12",JSON.stringify(await client.run(`(async()=>{
var cs=null;(function w(n){if(n.type==="COMPONENT_SET"&&n.name==="Demo/Card")cs=n;if("children"in n){for(var i=0;i<n.children.length;i++)w(n.children[i]);}})(figma.root);
if(!cs)return{error:"not found"};await figma.loadFontAsync({family:"Inter",style:"Regular"});var a=0;
for(var ci=0;ci<cs.children.length;ci++){var c=cs.children[ci];if(c.name.indexOf("Style=Icon")===-1)continue;var d=null;for(var ii=0;ii<ctx.d.length;ii++){if(c.name.indexOf("Size="+ctx.d[ii].k)>=0){d=ctx.d[ii];break}}if(!d)continue;var f=c.children[0];if(!f||f.name!=="Icon")continue;f.layoutMode="HORIZONTAL";f.primaryAxisAlignItems="CENTER";f.counterAxisAlignItems="CENTER";f.primaryAxisSizingMode="FIXED";f.counterAxisSizingMode="FIXED";var t=figma.createText();t.fontName={family:"Inter",style:"Regular"};t.characters=d.c;t.fontSize=d.z;t.fills=[{type:"SOLID",color:{r:1,g:1,b:1}}];t.textAlignHorizontal="CENTER";t.textAlignVertical="CENTER";t.name="IconChar";f.appendChild(t);a++}
return{applied:a};})()`,{d:[{k:"Sm",c:"\u2605",z:16},{k:"Md",c:"\u2605",z:22},{k:"Lg",c:"\u2605",z:28}]})));

console.log("=== All 12 phases complete ===");
console.log("COLOR vars -> fills, strokes, text colors");
console.log("FLOAT vars -> gap, padding, radius, opacity, strokeWidth, fontSize, lineHeight, fontWeight");
console.log("STRING vars -> fontFamily, fontStyle");
console.log("3-level chain: primitives -> semantic -> component");
console.log("Text styles & Color styles with variable bindings");
console.log("Demo/Button(45), Demo/Card(9), Demo/Nav(2)");
console.log("Nested Instance, Image fills, Icon chars");
client.close();