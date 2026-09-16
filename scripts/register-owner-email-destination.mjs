const token=process.env.CLOUDFLARE_API_TOKEN;
if(!token)throw new Error("Cloudflare secret missing");
const root="https://api.cloudflare.com/client/v4/accounts/af75a230de2eea882606db8d9acce473/email/routing/addresses";
const headers={authorization:"Bearer "+token,"content-type":"application/json"};
const listed=await fetch(root,{headers});const data=await listed.json();
if(!listed.ok||!data.success)throw new Error("Destination lookup failed");
let destination=data.result.find(d=>d.email==="bechirobob@gmail.com");
if(!destination){
 const response=await fetch(root,{method:"POST",headers,body:JSON.stringify({email:"bechirobob@gmail.com"})});
 const created=await response.json();
 if(!response.ok||!created.success)throw new Error("Destination creation failed: "+JSON.stringify(created.errors));
 destination=created.result;
}
console.log(JSON.stringify({id:destination.id,email:destination.email,verified:destination.verified,verificationSent:!destination.verified}));
