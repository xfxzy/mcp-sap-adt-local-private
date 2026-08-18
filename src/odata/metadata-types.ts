export interface ODataProperty {
  name: string;
  type: string;
  nullable: boolean;
  maxLength?: number;
  precision?: number;
  scale?: number;
}

export interface ODataEntityType {
  name: string;
  keys: string[];
  properties: Record<string, ODataProperty>;
}

export interface ODataEntitySet {
  name: string;
  entityType: string;
}

export interface ODataFunctionImport {
  name: string;
  httpMethod?: string;
  returnType?: string;
}

export interface ODataServiceModel {
  entitySets: Record<string, ODataEntitySet>;
  entityTypes: Record<string, ODataEntityType>;
  functionImports: Record<string, ODataFunctionImport>;
}
