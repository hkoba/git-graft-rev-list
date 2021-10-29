#!/usr/bin/env -S deno run --allow-all

export async function gitCmd(args: string[], directory?: string): Promise<Uint8Array> {
  const cmd = ['git', ...(directory ? ["-C", ...directory] : []), ...args];
  const pipe =  Deno.run({cmd, stdout: 'piped', stderr: 'piped'});
  const rc = await pipe.status();
  if (rc.code !== 0) {
    const err = await pipe.stderrOutput();
    throw new Error(`Error: ${decode(err)} from command: ${cmd.join(' ')}`)
  }
  return await pipe.output();
}

export async function currentBranchRaw(directory?: string): Promise<Uint8Array> {
  return await gitCmd(['symbolic-ref', '--short', 'HEAD'], directory)
}

export async function revisionList(args: string[], directory?: string): Promise<Uint8Array> {
  return await gitCmd(['rev-list', ...args], directory)
}

export async function catFile(cmmt: string, directory?: string): Promise<Uint8Array> {
  return await gitCmd(['cat-file', '-p', cmmt], directory)
}

export function decode(binary: Uint8Array): string {
  return new TextDecoder().decode(binary)
}

export function decodeTextLines(binary: Uint8Array): string[] {
  return decode(binary).trimRight().split("\n");
}

export type HashValue = string[40]

export type GitObjectBase = {
  gotype: string
  hash: HashValue
}

export type CommitObjItem = {
  tree: HashValue
  parent: HashValue[]
  author: string
  committer: string
}

export type CommitObj = GitObjectBase & CommitObjItem & {
  message: string
}

export type commitObjKeys = keyof CommitObjItem;

export function parseCommit(hash: HashValue, commitObj: string): CommitObj {
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
