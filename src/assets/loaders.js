import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

export const manager = new THREE.LoadingManager();

export const textureLoader = new THREE.TextureLoader(manager);
export const gltfLoader = new GLTFLoader(manager);
export const hdrLoader = new RGBELoader(manager).setDataType(THREE.FloatType);

export const assetUrl = (path) => `${import.meta.env.BASE_URL}assets/${path}`;
