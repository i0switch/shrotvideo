# X Screenshot CLI

This is a CLI tool to capture screenshots of the latest N posts from a specified X account.

## Prerequisites

- Node.js
- npm (or pnpm/yarn)

## Installation

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```

## Usage

### 1. Login

Before you can grab any posts, you need to log in to your X account. Run the following command:

```bash
npm run login
```

This will open a Chromium browser. Please log in to your X account manually. After a successful login, your session information will be saved to `.auth/x.storage.json`, and the browser will close automatically.

### 2. Grab Posts

To capture screenshots, use the `grab` command:

```bash
npm run grab -- -u <username> -n <count>
```

**Arguments:**

- `-u, --user`: The X handle of the user (e.g., `X`). (Required)
- `-n, --count`: The number of latest posts to capture. (Default: 5)
- `-o, --outDir`: The directory to save screenshots to. (Default: `out/screenshots`)

**Example:**

```bash
npm run grab -- -u X -n 10
```

This will save the 10 latest posts from the user `X` into the `out/screenshots/X/` directory.

### 3. Run Tests

To run the test suite, which includes E2E tests and image comparison tests:

```bash
npm test
```

## Troubleshooting

- **Login Fails**: If the login process fails or times out, try running `npm run login` again. Make sure you complete the login within 5 minutes.
- **Incorrect Screenshots**: The tool relies on X's HTML structure. If X updates its website, the locators in `src/grab.ts` might need to be updated.

## Disclaimer

This tool is for personal and educational use only. Please respect X's terms of service. The developers of this tool are not responsible for any misuse.
