import {parsePES} from './pes.js';

// A bounded data transfer, not a path reader or remote fetch facility.
export function decodePESCommand({filename,base64,focus}) {
  if(typeof filename!=='string'||!filename.length||filename.length>120)throw Error('Use a filename up to 120 characters.');
  if(typeof base64!=='string'||base64.length>1398104||!base64.length||base64.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw Error('Supply valid base64 PES data up to 1 MiB.');
  if(focus&&(![focus.x,focus.y,focus.w,focus.h].every(Number.isFinite)||focus.w<=0||focus.h<=0||focus.w>200||focus.h>200))throw Error('Preview region must have positive dimensions up to 200 mm.');
  const binary=atob(base64);
  if(binary.length>1024*1024)throw Error('Connector PES files are limited to 1 MiB. Use Preview PES for larger files.');
  return parsePES(Uint8Array.from(binary,c=>c.charCodeAt(0)),filename);
}
