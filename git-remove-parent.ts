#!/usr/bin/env -S deno run --allow-all

import {
  gitCmd, decode
  , parsedCommitList
} from './git-wrapper.ts'

if (Deno.args.length <= 1) {
  throw new Error(`Usage: remove-parent STARTING-COMMIT REMOVED-COMMIT-ID...`)
}

const [start, ...toBeRemoved] = Deno.args

console.log(start, toBeRemoved)

const removedSet: Set<string> = new Set
toBeRemoved.forEach((h) => removedSet.add(h))

const branch = decode(await gitCmd(['symbolic-ref', 'HEAD'])).trimRight()

const commitList = await parsedCommitList([start + ".." + branch])

const replaceMap: Map<string, string> = new Map

for (const cmmt of commitList) {
  const newParent = cmmt.parent
    .filter(h => !removedSet.has(h))
    .map(h => replaceMap.get(h) ?? h)
  console.log(cmmt.hash, cmmt.parent, '=>', newParent)

  await gitCmd(['replace', '--graft', cmmt.hash, ...newParent])
  const replace = decode(Deno.readFileSync(`.git/refs/replace/${cmmt.hash}`)).trim()
  console.log(`replace ${cmmt.hash} with ${replace}`)
  replaceMap.set(cmmt.hash, replace)

  await gitCmd(['replace', '-d', cmmt.hash])
}

const lastCmmt = commitList[commitList.length - 1]!

const lastHash = replaceMap.get(lastCmmt.hash)!

await gitCmd(['update-ref', branch, lastHash])

await gitCmd(['reset', '--hard', branch])
