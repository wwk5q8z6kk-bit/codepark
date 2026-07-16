export const defaultPolicy = {
  write: {
    allow: [],
    deny: ['.git/**', 'node_modules/**']
  },
  commands: {
    denyCommands: ['sudo'],
    denyPatterns: []
  }
};

export const policyPresets = {
  default: defaultPolicy,
  strict: {
    write: {
      allow: ['.codepark/**', 'README.md', 'CHANGELOG.md', 'docs/**', 'src/**', 'test/**', 'tests/**'],
      deny: ['.git/**', 'node_modules/**', '.env', '.env.*', 'dist/**', 'build/**', 'coverage/**']
    },
    commands: {
      denyCommands: ['sudo', 'docker', 'podman', 'ssh', 'scp', 'rsync'],
      denyPatterns: ['npm publish', 'npm login', 'twine upload', '--production']
    }
  },
  'node-app': {
    write: {
      allow: [
        '.codepark/**',
        'README.md',
        'CHANGELOG.md',
        'docs/**',
        'src/**',
        'test/**',
        'tests/**',
        'public/**',
        'package.json',
        'package-lock.json',
        'pnpm-lock.yaml',
        'yarn.lock',
        'tsconfig*.json',
        'vite.config.*'
      ],
      deny: ['.git/**', 'node_modules/**', '.env', '.env.*', 'dist/**', 'build/**', 'coverage/**']
    },
    commands: {
      denyCommands: ['sudo'],
      denyPatterns: ['npm publish', 'npm login']
    }
  },
  'python-app': {
    write: {
      allow: [
        '.codepark/**',
        'README.md',
        'CHANGELOG.md',
        'docs/**',
        'src/**',
        'test/**',
        'tests/**',
        'pyproject.toml',
        'requirements*.txt',
        'setup.py',
        'setup.cfg'
      ],
      deny: ['.git/**', '.venv/**', 'venv/**', '__pycache__/**', '.pytest_cache/**', 'dist/**', 'build/**', '.env', '.env.*']
    },
    commands: {
      denyCommands: ['sudo'],
      denyPatterns: ['twine upload', 'pip install --user', 'pip install -g']
    }
  },
  'java-app': {
    write: {
      allow: [
        '.codepark/**',
        'README.md',
        'CHANGELOG.md',
        'docs/**',
        'src/**',
        'test/**',
        'tests/**',
        'pom.xml',
        'build.gradle',
        'build.gradle.kts',
        'settings.gradle',
        'settings.gradle.kts',
        'gradle/**',
        'gradlew',
        'gradlew.bat'
      ],
      deny: ['.git/**', '.env', '.env.*', 'target/**', 'build/**', '.gradle/**', 'out/**']
    },
    commands: {
      denyCommands: ['sudo'],
      denyPatterns: ['mvn deploy', 'gradle publish', './gradlew publish']
    }
  },
  'php-app': {
    write: {
      allow: [
        '.codepark/**',
        'README.md',
        'CHANGELOG.md',
        'docs/**',
        'src/**',
        'test/**',
        'tests/**',
        'app/**',
        'config/**',
        'public/**',
        'composer.json',
        'composer.lock',
        'phpunit.xml',
        'phpunit.xml.dist'
      ],
      deny: ['.git/**', '.env', '.env.*', 'vendor/**', 'var/cache/**', 'storage/logs/**', 'dist/**', 'build/**']
    },
    commands: {
      denyCommands: ['sudo'],
      denyPatterns: ['composer global', 'composer config --global']
    }
  },
  'ruby-app': {
    write: {
      allow: [
        '.codepark/**',
        'README.md',
        'CHANGELOG.md',
        'docs/**',
        'app/**',
        'config/**',
        'lib/**',
        'test/**',
        'tests/**',
        'spec/**',
        'Gemfile',
        'Gemfile.lock',
        'Rakefile',
        'config.ru'
      ],
      deny: ['.git/**', '.env', '.env.*', 'vendor/bundle/**', 'tmp/**', 'log/**', 'coverage/**', 'pkg/**']
    },
    commands: {
      denyCommands: ['sudo'],
      denyPatterns: ['gem push', 'bundle gem']
    }
  },
  'docs-only': {
    write: {
      allow: ['.codepark/**', 'README.md', 'CHANGELOG.md', 'docs/**', '*.md'],
      deny: ['.git/**', 'node_modules/**', 'src/**', 'test/**', 'tests/**', 'dist/**', 'build/**']
    },
    commands: {
      denyCommands: ['sudo', 'node', 'npm', 'python', 'python3', 'pip', 'pip3', 'docker', 'podman', 'git'],
      denyPatterns: []
    }
  }
};

export function listPolicyPresetNames() {
  return Object.keys(policyPresets).sort();
}

export function getPolicyPreset(name) {
  const presetName = String(name ?? '').trim();
  return clonePolicy(policyPresets[presetName]);
}

export function policyPresetExists(name) {
  return Boolean(policyPresets[String(name ?? '').trim()]);
}

function clonePolicy(policy) {
  if (!policy) return null;
  return {
    write: {
      allow: [...policy.write.allow],
      deny: [...policy.write.deny]
    },
    commands: {
      denyCommands: [...policy.commands.denyCommands],
      denyPatterns: [...policy.commands.denyPatterns]
    }
  };
}
