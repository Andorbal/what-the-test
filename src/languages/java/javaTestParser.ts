import { ParsedTestFile } from '../../core/types';
import { maskCSharp } from '../csharp/csharpMask';
import { Container, MethodInfo, buildDeclarations, findContainers, readMethod } from '../csharp/csharpTestParser';
import { findMatchingBracket, skipWhitespace } from '../text';

/** JUnit 5 and 4, TestNG and jqwik test annotations. */
export const DEFAULT_JAVA_TEST_ANNOTATIONS = [
  'Test', 'ParameterizedTest', 'RepeatedTest', 'TestFactory', 'TestTemplate', 'Property', 'Example',
];

/** Annotations marking methods that run around the tests of their class. */
export const DEFAULT_JAVA_SETUP_ANNOTATIONS = [
  'BeforeEach', 'AfterEach', 'BeforeAll', 'AfterAll',
  'Before', 'After', 'BeforeClass', 'AfterClass',
  'BeforeMethod', 'AfterMethod', 'BeforeTest', 'AfterTest', 'BeforeSuite', 'AfterSuite', 'BeforeGroups', 'AfterGroups',
  'BeforeProperty', 'AfterProperty', 'BeforeTry', 'AfterTry', 'BeforeContainer', 'AfterContainer',
];

export interface JavaTestParserOptions {
  testAnnotations?: readonly string[];
  setupAnnotations?: readonly string[];
}

/**
 * Finds tests in Java source: annotated methods (`@Test`, `@ParameterizedTest`,
 * ...), the classes that contain them (including `@Nested` ones) as suites,
 * setup methods (`@BeforeEach`, ...) and test class constructors as setup.
 * Java's comments and strings (including text blocks) follow the same rules
 * as C#'s for masking, and its classes and methods are shaped the same way.
 */
export function parseJavaTests(text: string, options: JavaTestParserOptions = {}): ParsedTestFile {
  const masked = maskCSharp(text);
  const containers: Container[] = findContainers(masked);
  const pkg = /^\s*package\s+([\w.]+)\s*;/m.exec(masked);
  if (pkg) {
    containers.push({ kind: 'namespace', name: pkg[1], start: pkg.index, bodyStart: pkg.index + pkg[0].length, end: masked.length });
  }
  return buildDeclarations(text, masked, containers, findAnnotatedMethods(masked), {
    testAttributes: new Set(options.testAnnotations ?? DEFAULT_JAVA_TEST_ANNOTATIONS),
    setupAttributes: new Set(options.setupAnnotations ?? DEFAULT_JAVA_SETUP_ANNOTATIONS),
    lifecycleMethods: new Set(),
  });
}

/** Finds every method preceded by one or more annotations. */
function findAnnotatedMethods(masked: string): MethodInfo[] {
  const methods: MethodInfo[] = [];
  const annotation = /@\s*([A-Za-z_][\w.]*)/y;
  for (let i = masked.indexOf('@'); i !== -1; i = masked.indexOf('@', i + 1)) {
    if (!isMemberStart(masked, i)) {
      continue;
    }
    const attributes: string[] = [];
    let cursor = i;
    while (masked[cursor] === '@' && !masked.startsWith('@interface', cursor)) {
      annotation.lastIndex = cursor;
      const m = annotation.exec(masked);
      if (!m) {
        break;
      }
      attributes.push(m[1].split('.').pop()!);
      cursor = skipWhitespace(masked, cursor + m[0].length);
      if (masked[cursor] === '(') {
        const close = findMatchingBracket(masked, cursor);
        if (close === -1) {
          break;
        }
        cursor = skipWhitespace(masked, close + 1);
      }
    }
    const method = attributes.length ? readMethod(masked, cursor) : undefined;
    if (method) {
      methods.push({ ...method, start: i, attributes });
      i = method.end - 1;
    } else {
      i = Math.max(i, cursor - 1);
    }
  }
  return methods;
}

/** True if the annotation at `offset` starts a member, rather than annotating a parameter or type use. */
function isMemberStart(masked: string, offset: number): boolean {
  let j = offset - 1;
  while (j >= 0 && /\s/.test(masked[j])) {
    j--;
  }
  return j < 0 || '{};'.includes(masked[j]);
}
