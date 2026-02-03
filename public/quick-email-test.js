const nodemailer = require('nodemailer');

console.log('Email Test Starting...\n');

const testConfigs = [
  { name: 'donotreply@akersolutions.com', from: 'donotreply@akersolutions.com' },
  { name: 'no-reply@akersolutions.com', from: 'no-reply@akersolutions.com' },
  { name: 'notifications@akersolutions.com', from: 'notifications@akersolutions.com' },
  { name: 'system@akersolutions.com', from: 'system@akersolutions.com' }
];

async function testOne(config) {
  console.log('Testing: ' + config.name);
  
  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.enterdir.com',
      port: 25,
      secure: false,
      tls: { rejectUnauthorized: false }
    });
    
    await transporter.verify();
    console.log('  Connection OK');
    
    const result = await transporter.sendMail({
      from: config.from,
      to: 'Mahadevan.Sivasubramanian.Karthic@akersolutions.com',
      envelope: { from: config.from, to: ['Mahadevan.Sivasubramanian.Karthic@akersolutions.com'] },
      subject: 'Test from ' + config.name,
      text: 'Test email'
    });
    
    console.log('  SUCCESS! Message ID: ' + result.messageId);
    console.log('\nWORKING CONFIG:');
    console.log('from: "' + config.from + '"');
    console.log('envelopeFrom: "' + config.from + '"');
    return true;
  } catch (err) {
    console.log('  FAILED: ' + err.message);
    return false;
  }
}

async function runTests() {
  for (let i = 0; i < testConfigs.length; i++) {
    const worked = await testOne(testConfigs[i]);
    if (worked) {
      console.log('\nFound working config!');
      return;
    }
    console.log('');
  }
  console.log('All tests failed - need IT approval');
}

runTests();