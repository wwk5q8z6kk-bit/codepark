#!/usr/bin/env node
import { checkJavaScriptSyntax } from '../src/syntaxCheck.js';

try {
  console.log(await checkJavaScriptSyntax(process.cwd()));
} catch (error) {
  console.error(error?.message ?? String(error));
  process.exitCode = 1;
}
