系统：Todo 待办（单表）
实体 Todo { id: Integer（主键）; title: String（必填）; done: Boolean; }
要求（单文件 TDSL）：
- function listTodos(): List<Todo> —— 全表
- function createTodo(input: TodoInput): Todo —— struct TodoInput { title: String }
- function toggleTodo(id: Integer): Todo —— 翻转 done 并 save
- function deleteTodo(id: Integer): Boolean
- interface TodoApi：'/api/todos' GET/POST、'/api/todos/{id}' DELETE + toggle
- page TodoList：表格列 title/done，行按钮 翻转(toggleTodo)/删除(deleteTodo)，页面按钮 新增（跳转 or 弹窗自选）