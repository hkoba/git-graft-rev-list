#!/usr/bin/env -S deno run --allow-all
// -*- mode: typescript -*-

import {
  gitCmd, decode
  , parsedCommitList
  , createCommitWithParents
} from './git-wrapper.ts'

const branch = decode(await gitCmd(['symbolic-ref', 'HEAD'])).trimRight()

const history = await parsedCommitList([branch]);
const head = history[history.length - 1]

const revList = await parsedCommitList(Deno.args)

if (head != null && revList.length) {
  // Check whether current HEAD and revList[0] has same tree.

  console.log(`branch head: `, head)

  const graftedHead = revList[0]
  console.log(`grafted head: `, graftedHead)
  if (graftedHead == null)
    throw new Error(`rev-list is empty`)
  if (head.tree !== graftedHead.tree) {
    throw new Error(`Tree hash mismatch! branch ${branch} head: ${head.tree} graftHead: ${graftedHead.tree}`)
  }

  // Create git replace --graft for all revList to reparent with working history
  const replaceMap: Map<string,string> = new Map
  let graftedRest
  if (graftedHead.parent.length > 0) {
    graftedRest = revList
    for (const hash of graftedHead.parent) {
      replaceMap.set(hash, head.hash)
    }
  } else {
    await createCommitWithParents(replaceMap, graftedHead, [head.hash])
    graftedRest = revList.slice(1)
    console.log(`rest head: `, graftedRest[0])
  }
  for (const cmmt of graftedRest) {
    if (cmmt.parent.length === 0) {
      console.log('SKIPPED: ', cmmt)
      continue;
    }
    else if (cmmt.parent.filter(h => replaceMap.has(h)).length === 0) {
      console.log(`Can't set parent for commit:`, cmmt)
      console.log(`replaceMap: `, replaceMap)
      Deno.exit(1)
    }
    else {
      // console.log('REPLACING...', cmmt)
    }

    const replace = await createCommitWithParents(replaceMap, cmmt)
    console.log(`replaced ${cmmt.hash} with ${replace}. #replaceMap = ${replaceMap.size}`)
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
