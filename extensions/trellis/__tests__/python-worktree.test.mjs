// Keep standard-library unit tests in the default npm test gate.
import { execFileSync } from 'node:child_process';
import test from 'node:test';
test('Python native contract unit suite',()=>{
 execFileSync(process.env.TRELLIS_PYTHON || 'python3',['-B','-m','unittest','discover','-s','__tests__/python','-p','test_*.py'],{cwd:new URL('../',import.meta.url),env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},stdio:'pipe'});
});
