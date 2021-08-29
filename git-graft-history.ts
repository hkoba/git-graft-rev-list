#!/usr/bin/env -S deno run --allow-all
// -*- mode: typescript -*-

async function gitCmd(args: string[], directory?: string): Promise<Uint8Array> {
  const cmd = ['git', ...(directory ? ["-C", ...directory] : []), ...args];
  const pipe =  Deno.run({cmd, stdout: 'piped', stderr: 'piped'});
  const rc = await pipe.status();
  if (rc.code !== 0) {
    const err = await pipe.stderrOutput();
    throw new Error(`Error: ${decode(err)} from command: ${cmd.join(' ')}`)
  }
  return await pipe.output();
}

async function currentBranchRaw(directory?: string): Promise<Uint8Array> {
  return await gitCmd(['symbolic-ref', '--short', 'HEAD'], directory)
}

async function revisionList(args: string[], directory?: string): Promise<Uint8Array> {
  return await gitCmd(['rev-list', ...args], directory)
}

async function catFile(cmmt: string, directory?: string): Promise<Uint8Array> {
  return await gitCmd(['cat-file', '-p', cmmt], directory) 
}

function decode(binary: Uint8Array): string {
  return new TextDecoder().decode(binary)
}
function decodeTextLines(binary: Uint8Array): string[] {
  return decode(binary).trimRight().split("\n");
}

type HashValue = string[40]

type GitObjectBase = {
  gotype: string
  hash: HashValue
}
type CommitObjItem = {
  tree: HashValue
  parent: HashValue[]
  author: string
  committer: string
}
type CommitObj = GitObjectBase & CommitObjItem & {
  message: string
}
type commitObjKeys = keyof CommitObjItem;
function parseCommit(hash: HashValue, commitObj: string): CommitObj {
  let tree, author, committer, message, parent = []
  let re = /(?<key>tree|parent|author|committer) (?<value>[^\n]+)\n/y
  type Match = {key: string, value: string}
  let m, lastIndex = 0;
  while ((m = re.exec(commitObj)) != null) {
    const mg = m.groups! as unknown as Match
    switch (mg.key) {
      case 'tree': 
        tree = mg.value; break;
      case 'author': 
        author = mg.value; break;
      case 'committer': 
        committer = mg.value; break;
      case 'parent':
        parent.push(mg.value); break;
      default:
        console.log(m)
        throw new Error(`Really? ${m[0]}`)
    }
    lastIndex = re.lastIndex
  }
  if (commitObj.charAt(lastIndex) !== `\n`) 
    throw new Error(`Invalid commit object: ${commitObj}`)
  message = commitObj.substring(lastIndex+1).trimRight()
  if (tree == null || author == null || committer == null || message == null)
    throw new Error(`Invalid commit object: ${commitObj} tree=${tree} author=${author} committer=${committer}`)
  return {gotype: 'commit', hash, parent, tree, author, committer, message}
}

////

let head, branch
{
  branch = decode(await gitCmd(['symbolic-ref', 'HEAD'])).trimRight()
  const headHash = decode(await gitCmd(['rev-parse', branch])).trimRight()
  const commit = decode(await catFile(headHash)).trimRight()
  head = parseCommit(headHash, commit)
  console.log(head)
}

const revList = await Promise.all(decodeTextLines(await revisionList(Deno.args)).reverse().map(async cmmt => {
  const objStr = await catFile(cmmt)
  const obj = parseCommit(cmmt, decode(objStr))
  return obj
}))

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
