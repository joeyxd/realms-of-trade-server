// Own and release only the optional appearance modules; the cached base meshes stay intact.
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { assembleAppearance, APPEARANCE_CHOICES, DEFAULT_APPEARANCE, normalizeAppearance } from '../character-appearance-v1/assemble.mjs';
export { DEFAULT_APPEARANCE, normalizeAppearance };

export function mountAppearanceControls(onChange) {
  const buttonFields = { hairId:'hair-options',beardId:'beard-options',eyesId:'eye-options',browsId:'brow-options',irisPaletteId:'iris-options' };
  for (const [key,id] of Object.entries(buttonFields)) {
    const holder=document.getElementById(id);
    for(const option of APPEARANCE_CHOICES[key]) {
      const button=document.createElement('button');button.type='button';button.dataset.appearanceField=key;button.dataset.option=option.id;
      button.textContent=option.label;button.setAttribute('aria-pressed','false');
      if(option.color){button.classList.add('color-option');button.style.setProperty('--option-color',option.color);}
      holder.append(button);
    }
    holder.addEventListener('click',event=>{
      const button=event.target.closest('[data-appearance-field]');if(button)onChange(button.dataset.appearanceField,button.dataset.option);
    });
  }
  for(const key of ['hairPaletteId','beardPaletteId','browPaletteId']) {
    const select=document.querySelector(`[data-appearance-select="${key}"]`);
    for(const entry of APPEARANCE_CHOICES[key])select.add(new Option(entry.label,entry.id));
    select.addEventListener('change',()=>onChange(key,select.value));
  }
}
export function syncAppearanceControls(descriptor) {
  for(const button of document.querySelectorAll('[data-appearance-field]'))button.setAttribute('aria-pressed',String(descriptor[button.dataset.appearanceField]===button.dataset.option));
  for(const select of document.querySelectorAll('[data-appearance-select]'))select.value=descriptor[select.dataset.appearanceSelect];
}
export function removeAppearance(model) {
  const eyes=model.meshes.find(m=>m.name==='eyes_base');if(eyes)eyes.visible=true;
  if(!model.appearance)return;
  for(const mesh of model.appearance.meshes){mesh.removeFromParent();mesh.geometry.dispose();mesh.userData.paintMaterial.dispose();mesh.userData.pbrMaterial.dispose();}
  model.appearance=null;
}
export function applyAppearance(model, descriptor, gradientMap) {
  const built=assembleAppearance(model.kind,descriptor);
  removeAppearance(model);
  const base=model.meshes.find(m=>m.name==='head_base'),meshes=[];
  for(const part of built.parts) {
    const doubleSided=['eyes','brows','accents'].includes(part.family);
    const material=new THREE.MeshToonMaterial({vertexColors:true,gradientMap,side:doubleSided?THREE.DoubleSide:THREE.FrontSide});
    const pbr=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.94,metalness:0,side:material.side});
    const mesh=new THREE.SkinnedMesh(part.geometry,material);mesh.name=part.name;
    mesh.position.copy(base.position);mesh.quaternion.copy(base.quaternion);mesh.scale.copy(base.scale);
    mesh.bind(base.skeleton,base.bindMatrix);mesh.bindMode=base.bindMode;
    mesh.castShadow=mesh.receiveShadow=true;mesh.frustumCulled=false;
    mesh.userData={family:part.family,paintMaterial:material,pbrMaterial:pbr};
    base.parent.add(mesh);meshes.push(mesh);
  }
  model.meshes.find(m=>m.name==='eyes_base').visible=false;
  model.appearance={descriptor:built.descriptor,meshes};model.root.updateMatrixWorld(true);
  return model.appearance;
}
export function visibleMeshes(model) {
  return [...model.meshes,...(model.appearance?.meshes||[])].filter(mesh=>mesh.visible);
}
export async function exportAppearance(model, skinColor) {
  if(!model.appearance)throw new Error('Appearance is not enabled');
  const sourceMeshes=new Map([...model.meshes,...model.appearance.meshes].map(mesh=>[mesh.name,mesh]));
  // Material and typed-array caches belong to the live instance, not to Object3D JSON metadata.
  const metadata=[];let snapshot;
  model.root.traverse(object=>{metadata.push([object,object.userData]);object.userData={};});
  try{snapshot=clone(model.root);}finally{for(const [object,data] of metadata)object.userData=data;}
  const owned=[];
  snapshot.userData={schema:'character-lab-appearance/v1',body:model.kind,baseVersion:model.version,
    appearance:{...model.appearance.descriptor},skinColor,textureSize:model.quality,
    scope:'P03a local composition; no saved identity or gameplay authority'};
  snapshot.traverse(object=>{
    if(object.isBone){object.rotation.set(0,0,0);object.position.copy(model.rests[object.name]);}
    if(!object.isMesh)return;
    if(object.name.endsWith('_outline')){object.visible=false;return;}
    object.geometry=object.geometry.clone();
    object.material=sourceMeshes.get(object.name).userData.pbrMaterial.clone();owned.push(object.geometry,object.material);
    object.userData={};
  });
  snapshot.updateMatrixWorld(true);
  try {return await new GLTFExporter().parseAsync(snapshot,{binary:true,onlyVisible:true});}
  finally {for(const resource of owned)resource.dispose();}
}
