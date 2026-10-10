# my-pi-extensions

My personal [pi](https://pi.dev) extensions, plus the list of pi packages I use on every machine.

## Set up a new machine

```sh
curl -fsSL https://raw.githubusercontent.com/AkiChase/my-pi-extensions/main/install.sh | sh
```

This installs this repo and the third-party packages listed in `install.sh`.

## Update

```sh
pi update --extensions
```

## Add an extension

Put it in `extensions/`, either as a single file (`extensions/foo.ts`) or as a folder with an entry point (`extensions/foo/index.ts`). pi finds it automatically, and no build step is needed. Push, then run `pi update --extensions` on the other machines.

## Add a third-party package

Add a `pi install ...` line to `install.sh`.
