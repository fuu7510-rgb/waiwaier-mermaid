import { describe, it, expect } from 'vitest';
import { parseERDiagram } from '../parser/er-parser.js';

// ---------------------------------------------------------------------------
// erDiagram宣言
// ---------------------------------------------------------------------------
describe('erDiagram宣言', () => {
  it('erDiagramキーワードで始まるテキストをパースできる', () => {
    const source = `erDiagram
  USER {
    int id PK
  }
`;
    const result = parseERDiagram(source);
    expect(result.entities.has('USER')).toBe(true);
  });

  it('erDiagramキーワードがない場合は空の結果を返す', () => {
    const source = `USER {
  int id PK
}
`;
    const result = parseERDiagram(source);
    expect(result.entities.size).toBe(0);
    expect(result.relationships).toHaveLength(0);
  });

  it('erDiagram後にタイトルテキストがある行はerDiagramとして認識しない', () => {
    // ER_DIAGRAM_RE is /^\s*erDiagram\s*$/ — trailing text prevents match
    const source = `erDiagram My Title
  USER {
    int id PK
  }
`;
    const result = parseERDiagram(source);
    // insideErDiagram never becomes true, so entities remain empty
    expect(result.entities.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// エンティティ
// ---------------------------------------------------------------------------
describe('エンティティ', () => {
  it('属性付きエンティティをパースできる（int id PK, varchar name, varchar email UK）', () => {
    const source = `erDiagram
  USERS {
    int id PK
    varchar name
    varchar email UK
  }
`;
    const result = parseERDiagram(source);
    const entity = result.entities.get('USERS');
    expect(entity).toBeDefined();
    expect(entity!.attributes).toHaveLength(3);

    const id = entity!.attributes[0];
    expect(id.type).toBe('int');
    expect(id.name).toBe('id');
    expect(id.keys).toContain('PK');

    const name = entity!.attributes[1];
    expect(name.type).toBe('varchar');
    expect(name.name).toBe('name');
    expect(name.keys).toHaveLength(0);

    const email = entity!.attributes[2];
    expect(email.type).toBe('varchar');
    expect(email.name).toBe('email');
    expect(email.keys).toContain('UK');
  });

  it('ラベル付きエンティティ ["..."] をパースできる', () => {
    const source = `erDiagram
  USERS["ユーザー"] {
    int id PK
  }
`;
    const result = parseERDiagram(source);
    const entity = result.entities.get('USERS');
    expect(entity).toBeDefined();
    expect(entity!.label).toBe('ユーザー');
  });

  it('ラベルなしの場合はlabelが空文字', () => {
    const source = `erDiagram
  USERS {
    int id PK
  }
`;
    const result = parseERDiagram(source);
    const entity = result.entities.get('USERS');
    expect(entity).toBeDefined();
    expect(entity!.label).toBe('');
  });

  it('コメント付き属性（"主キー"）をパースできる', () => {
    const source = `erDiagram
  ORDERS {
    int id PK "主キー"
    varchar status "注文状態"
  }
`;
    const result = parseERDiagram(source);
    const entity = result.entities.get('ORDERS');
    expect(entity).toBeDefined();

    const id = entity!.attributes[0];
    expect(id.comment).toBe('主キー');

    const status = entity!.attributes[1];
    expect(status.comment).toBe('注文状態');
  });

  it('複合キー PK,FK をパースできる', () => {
    const source = `erDiagram
  ORDER_ITEMS {
    int order_id PK,FK
    int product_id PK,FK
  }
`;
    const result = parseERDiagram(source);
    const entity = result.entities.get('ORDER_ITEMS');
    expect(entity).toBeDefined();

    const orderId = entity!.attributes[0];
    expect(orderId.keys).toContain('PK');
    expect(orderId.keys).toContain('FK');
  });
});

// ---------------------------------------------------------------------------
// リレーションシップ
// ---------------------------------------------------------------------------
describe('リレーションシップ', () => {
  it('基本的なリレーションをパースできる（USERS ||--o{ ORDERS : "places"）', () => {
    const source = `erDiagram
  USERS ||--o{ ORDERS : "places"
`;
    const result = parseERDiagram(source);
    expect(result.relationships).toHaveLength(1);

    const rel = result.relationships[0];
    expect(rel.entityA).toBe('USERS');
    expect(rel.entityB).toBe('ORDERS');
    expect(rel.label).toBe('places');
    expect(rel.identifying).toBe(true);

    // || => one-to-one on entityA side
    expect(rel.cardinalityA).toEqual({ min: 'one', max: 'one' });
    // o{ => zero-to-many on entityB side
    expect(rel.cardinalityB).toEqual({ min: 'zero', max: 'many' });
  });

  it('非識別リレーション（..）は identifying === false', () => {
    const source = `erDiagram
  USERS ||..o{ ORDERS : "has"
`;
    const result = parseERDiagram(source);
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0].identifying).toBe(false);
  });

  it('カーディナリティ記号 }o--|| をパースできる', () => {
    const source = `erDiagram
  ORDERS }o--|| USERS : "belongs to"
`;
    const result = parseERDiagram(source);
    expect(result.relationships).toHaveLength(1);

    const rel = result.relationships[0];
    // }o => zero-to-many on entityA side
    expect(rel.cardinalityA).toEqual({ min: 'zero', max: 'many' });
    // || => one-to-one on entityB side
    expect(rel.cardinalityB).toEqual({ min: 'one', max: 'one' });
  });

  it('ラベルなしリレーション（: ""）をパースできる', () => {
    const source = `erDiagram
  USERS ||--o{ ORDERS : ""
`;
    const result = parseERDiagram(source);
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0].label).toBe('');
  });

  it('リレーション行に含まれるエンティティが entities に追加される', () => {
    const source = `erDiagram
  USERS ||--o{ ORDERS : "places"
`;
    const result = parseERDiagram(source);
    expect(result.entities.has('USERS')).toBe(true);
    expect(result.entities.has('ORDERS')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// エッジケース
// ---------------------------------------------------------------------------
describe('エッジケース', () => {
  it('空行を無視する', () => {
    const source = `erDiagram

  USERS {

    int id PK

  }

`;
    const result = parseERDiagram(source);
    expect(result.entities.has('USERS')).toBe(true);
    expect(result.entities.get('USERS')!.attributes).toHaveLength(1);
  });

  it('コメント行（%%）を無視する', () => {
    const source = `erDiagram
%% This is a comment
  USERS {
    %% another comment
    int id PK
  }
`;
    const result = parseERDiagram(source);
    // %% comment inside entity block still triggers SKIP_RE, so it is skipped
    // but the entity block continues (SKIP_RE causes `continue` before currentEntity check)
    const entity = result.entities.get('USERS');
    expect(entity).toBeDefined();
    expect(entity!.attributes).toHaveLength(1);
  });

  it('不正な行を無視する', () => {
    const source = `erDiagram
  THIS IS NOT VALID SYNTAX AT ALL !!!
  USERS {
    int id PK
  }
`;
    const result = parseERDiagram(source);
    // The garbage line doesn't crash the parser and USERS is still parsed
    expect(result.entities.has('USERS')).toBe(true);
  });

  it('空の入力で空の結果を返す', () => {
    const result = parseERDiagram('');
    expect(result.entities.size).toBe(0);
    expect(result.relationships).toHaveLength(0);
  });

  it('スタンドアロンエンティティ名（ブロックなし）をエンティティとして登録する', () => {
    const source = `erDiagram
  STANDALONE_ENTITY
`;
    const result = parseERDiagram(source);
    expect(result.entities.has('STANDALONE_ENTITY')).toBe(true);
    expect(result.entities.get('STANDALONE_ENTITY')!.attributes).toHaveLength(0);
  });

  it.todo('パラメータ付き型 varchar(255) は未対応（ATTRIBUTE_REがマッチしない）');
});
