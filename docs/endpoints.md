# エンドポイントと機能構成

このドキュメントでは、アプリケーションのエンドポイントと機能構成について説明します。

## APIエンドポイント

アプリケーションは、`apiProvider`設定によって決定される以下のAPIエンドポイントをサポートしています。

- **anthropic**: Anthropic APIを使用します。
- **openrouter**: OpenRouter APIを使用します。単一のエンドポイントを介して様々なモデルへのアクセスを可能にします。
- **bedrock**: AWS Bedrockを使用します。AWS Bedrockで利用可能なモデルへのアクセスを提供します。
- **vertex**: Google Vertex AIを使用します。Google Cloud上のモデルへのアクセスを提供します。
- **openai**: OpenAI APIを使用します。
- **ollama**: ローカルのOllamaサーバーに接続します。
- **lmstudio**: ローカルのLM Studioサーバーに接続します。
- **gemini**: Gemini APIを使用します。
- **openai-native**: ネイティブストリーミングでOpenAI APIを使用します。
- **deepseek**: DeepSeek APIを使用します。
- **mistral**: Mistral APIを使用します。
- **vscode-lm**: VS Codeによって提供される言語モデルを使用します（テストまたは内部使用を目的としています）。

各プロバイダーのベースエンドポイントURLは、`src/api/providers/`内のそれぞれのプロバイダーハンドラーファイルで設定されています。

## 機能構成

アプリケーションの機能は、APIハンドラーを構築するために使用される`ApiConfiguration`インターフェースを通じて構成されます。以下のオプションが利用可能であり、その具体的な使用方法は選択された`apiProvider`に依存します。

- **apiProvider**: 使用するAPIプロバイダーを指定します（上記の「APIエンドポイント」セクションにリストされているとおり）。これは必須の設定です。
- **...options**: 各APIプロバイダーに固有の追加オプション。これらのオプションには、APIキー、モデル名、およびその他のプロバイダー固有の設定が含まれる場合があります。

各`apiProvider`の具体的な構成オプションの詳細については、`src/api/providers/`ディレクトリのソースコードを参照してください。各プロバイダーには、独自のハンドラーファイル（例：`anthropic.ts`、`openai.ts`など）があります。これらのファイルには、各APIとの対話の実装が含まれており、構成可能なパラメータが含まれている場合があります。

たとえば、Anthropicプロバイダーを構成するには、構成で`apiProvider: "anthropic"`を設定します。APIキーの提供やモデルの指定も必要になる場合があります。同様に、OpenAIの場合は、`apiProvider: "openai"`を設定し、OpenAI APIキーと目的のモデルを構成します。

アプリケーションの機能は、主に選択された`apiProvider`とその関連構成によって決定されます。各プロバイダーは異なるモデルと機能を提供しており、構成により、ニーズに最適なエンドポイントを選択できます。
