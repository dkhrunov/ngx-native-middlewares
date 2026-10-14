/** @type {import('semantic-release').GlobalConfig} */
module.exports = {
  branches: ['main', 'master', 'development'],
  tagFormat: 'v${version}',
  plugins: [
    // Default "angular" preset ignores `feat!:` / `fix!:` — use conventionalcommits.
    [
      '@semantic-release/commit-analyzer',
      {
        preset: 'conventionalcommits',
      },
    ],
    [
      '@semantic-release/release-notes-generator',
      {
        preset: 'conventionalcommits',
      },
    ],
    // Bump version in the source package.json (always present at verifyConditions).
    [
      '@semantic-release/npm',
      {
        npmPublish: false,
        pkgRoot: 'projects/ngx-native-middlewares',
      },
    ],
    // Build after version bump, then publish the Angular dist package.
    [
      '@semantic-release/exec',
      {
        prepareCmd: 'npm run build',
        publishCmd: 'npm publish ./dist/ngx-native-middlewares --access public --provenance',
      },
    ],
    [
      '@semantic-release/git',
      {
        assets: ['projects/ngx-native-middlewares/package.json'],
        message: 'chore(release): ${nextRelease.version} [skip ci]',
      },
    ],
    '@semantic-release/github',
  ],
};
