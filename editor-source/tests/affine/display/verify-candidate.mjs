import {reviewURL} from '../source-paths.mjs';
import fs from 'node:fs';import assert from 'node:assert/strict';import{createHash}from'node:crypto';
export function verifyCandidate(){const hashes=JSON.parse(fs.readFileSync(reviewURL('./candidate-hashes.json',import.meta.url),'utf8'));for(const[name,want]of Object.entries(hashes)){const bytes=fs.readFileSync(reviewURL('../candidate/'+name,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),want,'Exact reviewed candidate '+name);}return hashes;}
