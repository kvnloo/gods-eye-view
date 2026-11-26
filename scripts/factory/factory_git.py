"""Small git helpers shared by the fork-factory checks.

Every helper refuses commands that write to a remote. The factory tools only
read remotes; publication upstream belongs to the `oss-factory-gev` cron.
"""
import os
import subprocess

# Subcommands that can write to another repository. None of the factory tools
# may run them, whatever their arguments.
REMOTE_WRITES = frozenset({'push', 'send-pack', 'request-pull'})


class GitError(RuntimeError):
    """A git command failed; carries its arguments and stderr."""

    def __init__(self, args, returncode, stderr):
        super().__init__(f"git {' '.join(args)} exited {returncode}: {stderr.strip()}")
        self.args_ = args
        self.returncode = returncode
        self.stderr = stderr


def _subcommand(args):
    """First argument that is not a global `-c key=value` option."""
    skip = False
    for arg in args:
        if skip:
            skip = False
            continue
        if arg in ('-c', '-C'):
            skip = True
            continue
        if arg.startswith('-'):
            continue
        return arg
    return None


def git_env():
    env = dict(os.environ)
    env['GIT_TERMINAL_PROMPT'] = '0'
    env.setdefault('GIT_AUTHOR_NAME', 'GEV factory check')
    env.setdefault('GIT_AUTHOR_EMAIL', 'gev-factory@users.noreply.github.com')
    env.setdefault('GIT_COMMITTER_NAME', env['GIT_AUTHOR_NAME'])
    env.setdefault('GIT_COMMITTER_EMAIL', env['GIT_AUTHOR_EMAIL'])
    return env


def run(args, cwd, check=True):
    """Run git; return CompletedProcess with text stdout/stderr."""
    if _subcommand(args) in REMOTE_WRITES:
        raise GitError(args, -1, 'refused: factory tools never write to remotes')
    result = subprocess.run(
        ['git', *args], cwd=cwd, env=git_env(), text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if check and result.returncode != 0:
        raise GitError(args, result.returncode, result.stderr)
    return result


def out(args, cwd):
    return run(args, cwd).stdout.strip()


def lines(args, cwd):
    text = out(args, cwd)
    return text.splitlines() if text else []


def checkout_state(cwd):
    """Snapshot of the caller's checkout, used to prove a tool left it untouched."""
    return {
        'head': out(['rev-parse', 'HEAD'], cwd),
        'symbolic': run(['symbolic-ref', '-q', 'HEAD'], cwd, check=False).stdout.strip(),
        'status': run(['status', '--porcelain=v1', '-uall'], cwd).stdout,
        'worktrees': out(['worktree', 'list', '--porcelain'], cwd),
    }
