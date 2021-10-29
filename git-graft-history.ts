#!/usr/bin/env -S deno run --allow-all
// -*- mode: typescript -*-

import {
  gitCmd, decode
  , parsedCommitList
} from './git-wrapper.ts'

const branch = decode(await gitCmd(['symbolic-ref', 'HEAD'])).trimRight()

const [head] = await parsedCommitList([branch]);

const revList = await parsedCommitList(Deno.args)

if (head != null && revList.length) {
  // Check whether current HEAD and revList[0] has same tree.

  const graftedHead = revList[0]
  if (graftedHead == null)
    throw new Error(`rev-list is empty`)
  if (head.tree !== graftedHead.tree) {
    throw new Error(`Tree hash mismatch!`)
  }

  // Create git replace --graft for all revList to reparent with working history
  const replaceMap: Map<string,string> = new Map
  for (const hash of graftedHead.parent!) {
    replaceMap.set(hash, head.hash)
  }
  for (const cmmt of revList) {
    if (cmmt.parent.length === 0 || cmmt.parent.filter(h => replaceMap.has(h)).length === 0) {
      console.log('SKIPPED: ', cmmt)
      continue;
    } else {
      console.log('REPLACING...', cmmt)
    }
    const newParent = cmmt.parent.map(h => replaceMap.get(h) ?? h);
    await gitCmd(['replace', '--graft', cmmt.hash, ...newParent])
    const replace = decode(Deno.readFileSync(`.git/refs/replace/${cmmt.hash}`)).trim()
    replaceMap.set(cmmt.hash, replace)

    // Having many replace object might cause problem, so delete them.
    await gitCmd(['replace', '-d', cmmt.hash])
  }

  // Move branch forward
  const lastCmmt = revList[revList.length - 1];
  if (lastCmmt == null)
    throw new Error(`Can't find last commit`);
  const lastHash = replaceMap.get(lastCmmt.hash)
  if (lastHash == null)
    throw new Error(`Can't find last hash`);
  await gitCmd(['update-ref', branch, lastHash])
  await gitCmd(['reset', '--hard', branch])
}
