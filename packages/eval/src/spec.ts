/** jxc spec 结构（与 check-spec 同型；此处只读） */
export interface SpecField { id: string; name: string; type: string; required?: boolean }
export interface SpecEntity { id: string; name: string; fields: SpecField[] }
export interface SpecEnum { id: string; name: string; items: Array<{ key: string; label: string }> }
export interface SpecAction { type: 'openDialog' | 'logic' | 'navigate'; target: string }
export interface SpecButton { id: string; name: string; scope: 'page' | 'row'; action?: SpecAction }
export interface SpecPage {
  id: string; name: string; kind: 'list' | 'dialog-form' | 'detail';
  entity?: string; query?: string; columns?: string[]; search?: string[]; fields?: string[];
  subform?: { repeat: string; entity: string; fields: string[] };
  buttons?: SpecButton[];
}
export interface SpecFunction { id: string; name: string; pages: SpecPage[] }
export interface SpecModule { id: string; name: string; functions: SpecFunction[] }
export interface Spec {
  system: { id: string; name: string; description: string };
  data: { enums: SpecEnum[]; entities: SpecEntity[] };
  modules: SpecModule[];
}
