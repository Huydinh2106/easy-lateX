import { spawn } from 'node:child_process';
const child=spawn('npm',['run','test','--workspace','@easy-latex/api'],{stdio:'inherit',env:{...process.env,COLLABORATION_INTEGRATION:'1'}});
child.on('exit',code=>process.exit(code??1));
