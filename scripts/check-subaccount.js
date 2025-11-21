const mongoose = require('mongoose');

(async () => {
  const conn = await mongoose.createConnection('mongodb+srv://business_db_user:Enz-Eu%25C5tQ3N7_@cluster0.rzui95d.mongodb.net/scalai_auth?retryWrites=true&w=majority&appName=Cluster0', {
    dbName: 'scalai_tenant'
  }).asPromise();
  
  const sub = await conn.db.collection('subaccounts').findOne({ _id: new mongoose.Types.ObjectId('68cf05f060d294db17c0685e') });
  
  console.log('Subaccount fields:');
  console.log('- name:', sub.name);
  console.log('- databaseName:', sub.databaseName);
  console.log('- has mongodbUrl:', !!sub.mongodbUrl);
  console.log('- has encryptionIV:', !!sub.encryptionIV);
  console.log('- has encryptionAuthTag:', !!sub.encryptionAuthTag);
  console.log('- encryptionAuthTag length:', sub.encryptionAuthTag?.length);
  console.log('- encryptionAuthTag value:', sub.encryptionAuthTag);
  
  await conn.close();
})();

