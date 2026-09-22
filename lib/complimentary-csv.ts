export type ComplimentaryRow={name:string;email:string;quantity:number};
/** Quoted fields, CRLF and embedded line breaks are handled before validation. */
export function parseComplimentaryCsv(input:string):ComplimentaryRow[]{
 if(input.length>100000)throw new Error('Choose a CSV smaller than 100 KB.');
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false;
 const s=input.replace(/^\uFEFF/u,'');
 for(let i=0;i<s.length;i++){
  const c=s[i];
  if(quoted){if(c==='"'){if(s[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;}
  else if(c==='"'){if(cell||closed)throw new Error('Check the CSV quotation marks.');quoted=true;}
  else if(c===','||c==='\n'||c==='\r'){row.push(cell.trim());cell='';closed=false;if(c!==','){if(row.some(Boolean))rows.push(row);row=[];if(c==='\r'&&s[i+1]==='\n')i++;}}
  else {if(closed&&!/\s/u.test(c))throw new Error('Check the CSV quotation marks.');cell+=c;}
 }
 if(quoted)throw new Error('A quoted CSV field is not closed.');row.push(cell.trim());if(row.some(Boolean))rows.push(row);
 if(rows.shift()?.map(x=>x.toLowerCase()).join(',')!=='name,email,quantity')throw new Error('Use the CSV headers name,email,quantity in that order.');
 if(!rows.length||rows.length>100)throw new Error('Add between 1 and 100 guests per import.');
 const emails=new Set<string>();return rows.map((r,i)=>{const [name,emailRaw,qty]=r,email=emailRaw?.toLowerCase(),quantity=Number(qty);
  if(r.length!==3||!name||name.length>100||!email||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)||!Number.isInteger(quantity)||quantity<1||quantity>20)throw new Error(`Row ${i+2}: add a name, valid email and 1–20 admissions.`);
  if(emails.has(email))throw new Error(`Row ${i+2}: ${email} appears twice. Combine their admissions in one row.`);emails.add(email);return {name,email,quantity};
 });
}
