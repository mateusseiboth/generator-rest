import {mkdir, readFile, readdir, writeFile} from "node:fs/promises";
import path from "node:path";
import {stdin as inputStream, stdout as outputStream} from "node:process";
import {createInterface} from "node:readline/promises";
import {fileURLToPath} from "node:url";
import ts from "typescript";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

const configPath = ts.findConfigFile(".", ts.sys.fileExists);

if (!configPath) {
  throw new Error("Não foi possível localizar o tsconfig.json.");
}

const config = ts.readConfigFile(configPath, ts.sys.readFile);

if (config.error) {
  throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
}

const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, ".");

const projectRoot = path.dirname(configPath);
const compilerOptions = config.config.compilerOptions ?? {};
const aliasPaths = compilerOptions.paths ?? {};
const baseUrl = compilerOptions.baseUrl ?? ".";

const prompt = createInterface({input: inputStream, output: outputStream});

async function ask(question: string) {
  return prompt.question(`${question}: `);
}

const modelInput = (await ask("Nome do Model")).trim();

const version = (await ask("Versão da API (Ex: v1, v2, etc)")).trim();

const modelPathName = modelInput.toLowerCase();
const modelName = modelInput.charAt(0).toUpperCase() + modelInput.slice(1);
const modelTag = modelPathName;
const tableName = modelPathName;

const templatesRoot = path.join(scriptDir, "templates");
const templateFiles = {
  controller: path.join(templatesRoot, "controller.hbs"),
  dao: path.join(templatesRoot, "dao.hbs"),
  model: path.join(templatesRoot, "model.hbs"),
  prisma: path.join(templatesRoot, "prisma.hbs"),
  router: path.join(templatesRoot, "router.hbs"),
  service: path.join(templatesRoot, "service.hbs"),
} as const;

function renderTemplate(template: string, variables: Record<string, string>) {
  return template.replace(/{{\s*(\w+)\s*}}/g, (_match, key: string) => variables[key] ?? "");
}

function templatePath(templatePath: string) {
  return path.resolve(scriptDir, templatePath);
}

function resolveAliasRoot(aliasName: string, fallbackSegments: string[]) {
  const wildcardKey = `${aliasName}/*`;
  const exactKey = aliasName;
  const target = aliasPaths[wildcardKey]?.[0] ?? aliasPaths[exactKey]?.[0];

  if (!target) {
    return path.join(projectRoot, ...fallbackSegments);
  }

  const resolved = path.resolve(projectRoot, baseUrl, target.replace(/\/\*$/, "").replace(/\*$/, ""));
  return resolved.endsWith(path.sep) ? resolved.slice(0, -1) : resolved;
}

async function findSchemaFile(rootDir: string): Promise<string | null> {
  const entries = await readdir(rootDir, {withFileTypes: true});

  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);

    if (entry.isFile() && entry.name === "schema.prisma") {
      return entryPath;
    }

    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") {
      const nestedSchema = await findSchemaFile(entryPath);
      if (nestedSchema) {
        return nestedSchema;
      }
    }
  }

  return null;
}

async function ensureDirectory(filePath: string) {
  await mkdir(path.dirname(filePath), {recursive: true});
}

async function writeRenderedTemplate(templateFile: string, destinationPath: string, variables: Record<string, string>) {
  const template = await readFile(templateFile, "utf8");
  const rendered = `${renderTemplate(template, variables).trimEnd()}\n`;

  await ensureDirectory(destinationPath);
  await writeFile(destinationPath, rendered, "utf8");

  return destinationPath;
}

const controllerRoot = resolveAliasRoot("@controller", ["controller"]);
const daoRoot = resolveAliasRoot("@dao", ["dao"]);
const modelRoot = resolveAliasRoot("@model", ["model"]);
const serviceRoot = resolveAliasRoot("@service", ["service"]);
const routesRoot = resolveAliasRoot("@routes", ["routes"]);

const controllerPath = path.join(controllerRoot, modelPathName, `${modelPathName}.ts`);
const daoPath = path.join(daoRoot, modelPathName, `${modelPathName}.ts`);
const modelPath = path.join(modelRoot, modelPathName, `${modelPathName}.ts`);
const servicePath = path.join(serviceRoot, modelPathName, `${modelPathName}.ts`);
const routerPath = path.join(routesRoot, "api", version, modelPathName, "index.ts");

await writeRenderedTemplate(templateFiles.controller, controllerPath, {
  modelName,
  modelPathName,
  modelTag,
  tableName,
});

await writeRenderedTemplate(templateFiles.dao, daoPath, {
  modelName,
  modelPathName,
  modelTag,
  tableName,
});

await writeRenderedTemplate(templateFiles.model, modelPath, {
  modelName,
  modelPathName,
  modelTag,
  tableName,
});

await writeRenderedTemplate(templateFiles.service, servicePath, {
  modelName,
  modelPathName,
  modelTag,
  tableName,
});

await writeRenderedTemplate(templateFiles.router, routerPath, {
  modelName,
  modelPathName,
  modelTag,
  tableName,
});

const schemaPath = await findSchemaFile(projectRoot);

if (schemaPath) {
  const schemaContent = await readFile(schemaPath, "utf8");
  const prismaTemplate = await readFile(templatePath(templateFiles.prisma), "utf8");
  const prismaBlock = renderTemplate(prismaTemplate, {
    modelName,
    modelPathName,
    modelTag,
    tableName,
  }).trim();

  if (!schemaContent.includes(`model ${modelName} {`)) {
    const separator = schemaContent.endsWith("\n") ? "\n" : "\n\n";
    await writeFile(schemaPath, `${schemaContent}${separator}${prismaBlock}\n`, "utf8");
  }
}

const createdFiles = [controllerPath, daoPath, modelPath, servicePath, routerPath];

console.log("Arquivos gerados:\n");
for (const filePath of createdFiles) {
  console.log(`- ${path.relative(projectRoot, filePath)}`);
}

if (schemaPath) {
  console.log(`- ${path.relative(projectRoot, schemaPath)} (schema Prisma atualizado)`);
} else {
  console.log("- Nenhum schema.prisma encontrado para atualização.");
}

prompt.close();

void parsed;
