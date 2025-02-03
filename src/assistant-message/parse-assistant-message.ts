import {
	AssistantMessageContent,
	TextContent,
	ToolUse,
	ToolParamName,
	toolParamNames,
	toolUseNames,
	ToolUseName,
  } from "./index.js";
  
  /**
   * アシスタントからのメッセージ文字列を解析し、テキストコンテンツやツール利用指示などのブロックに分割します。
   * ツール利用指示（<toolname>...</toolname>）と、そのパラメータ（<param>...</param>）を検出し、
   * テキスト部分は「text」ブロック、ツール利用は「tool_use」ブロックとして保持します。
   *
   * @param {string} assistantMessage - アシスタントからのメッセージ文字列
   * @returns {AssistantMessageContent[]} - 分割後のコンテンツブロック配列
   */
  export const parseAssistantMessage = (assistantMessage: string) => {
	// 解析結果を格納する配列
	let contentBlocks: AssistantMessageContent[] = [];
  
	// 現在処理中のテキストコンテンツ
	let currentTextContent: TextContent | undefined = undefined;
	// テキストコンテンツの開始インデックス
	let currentTextContentStartIndex = 0;
  
	// 現在処理中のツール利用情報
	let currentToolUse: ToolUse | undefined = undefined;
	// ツール利用ブロックの開始インデックス
	let currentToolUseStartIndex = 0;
  
	// 現在処理中のパラメータ名
	let currentParamName: ToolParamName | undefined = undefined;
	// パラメータ値の開始インデックス
	let currentParamValueStartIndex = 0;
  
	// 解析対象文字列を蓄積するバッファ
	let accumulator = "";
  
	console.log("[parseAssistantMessage] 開始: メッセージの解析を行います。");
	for (let i = 0; i < assistantMessage.length; i++) {
	  const char = assistantMessage[i];
	  accumulator += char;
  
	  // ----------------------------------------
	  // ■ ツール利用中 かつ パラメータ名が存在する場合の処理
	  // ----------------------------------------
	  if (currentToolUse && currentParamName) {
		const currentParamValue = accumulator.slice(currentParamValueStartIndex);
		const paramClosingTag = `</${currentParamName}>`;
  
		// パラメータ終了タグが見つかったかどうかをチェック
		if (currentParamValue.endsWith(paramClosingTag)) {
		  // パラメータ値の終了
		  currentToolUse.params[currentParamName] = currentParamValue
			.slice(0, -paramClosingTag.length)
			.trim();
		  console.log(
			`[parseAssistantMessage] パラメータ終了検出: ${currentParamName} => ${currentToolUse.params[currentParamName]}`
		  );
		  currentParamName = undefined;
		  continue;
		} else {
		  // パラメータ値の途中を蓄積中
		  continue;
		}
	  }
  
	  // ----------------------------------------
	  // ■ ツール利用中 かつ パラメータ名が未設定の場合の処理
	  // ----------------------------------------
	  if (currentToolUse) {
		// ツール利用の文字列を抽出
		const currentToolValue = accumulator.slice(currentToolUseStartIndex);
		const toolUseClosingTag = `</${currentToolUse.name}>`;
  
		// ツール利用終了タグの検出
		if (currentToolValue.endsWith(toolUseClosingTag)) {
		  // ツール利用の終了
		  currentToolUse.partial = false;
		  contentBlocks.push(currentToolUse);
		  console.log(
			`[parseAssistantMessage] ツール利用終了検出: ${currentToolUse.name}`
		  );
		  currentToolUse = undefined;
		  continue;
		} else {
		  // パラメータ開始タグを探す
		  const possibleParamOpeningTags = toolParamNames.map((name) => `<${name}>`);
		  for (const paramOpeningTag of possibleParamOpeningTags) {
			if (accumulator.endsWith(paramOpeningTag)) {
			  // パラメータ開始を検出
			  currentParamName = paramOpeningTag.slice(1, -1) as ToolParamName;
			  currentParamValueStartIndex = accumulator.length;
			  console.log(
				`[parseAssistantMessage] パラメータ開始検出: ${currentParamName}`
			  );
			  break;
			}
		  }
  
		  // write_to_file の特別ケース対応:
		  //   ファイル内容に閉じタグが含まれる場合があるため、
		  //   パラメータ<content>の最初から最後の出現位置までを取り出す。
		  const contentParamName: ToolParamName = "content";
		  if (
			currentToolUse.name === "write_to_file" &&
			accumulator.endsWith(`</${contentParamName}>`)
		  ) {
			const toolContent = accumulator.slice(currentToolUseStartIndex);
			const contentStartTag = `<${contentParamName}>`;
			const contentEndTag = `</${contentParamName}>`;
			const contentStartIndex =
			  toolContent.indexOf(contentStartTag) + contentStartTag.length;
			const contentEndIndex = toolContent.lastIndexOf(contentEndTag);
  
			if (
			  contentStartIndex !== -1 &&
			  contentEndIndex !== -1 &&
			  contentEndIndex > contentStartIndex
			) {
			  currentToolUse.params[contentParamName] = toolContent
				.slice(contentStartIndex, contentEndIndex)
				.trim();
			  console.log(
				`[parseAssistantMessage] write_to_file用のcontentパラメータを確定: ${currentToolUse.params[contentParamName]}`
			  );
			}
		  }
  
		  // ツール利用ブロックの途中とみなし続行
		  continue;
		}
	  }
  
	  // ----------------------------------------
	  // ■ ツール利用を開始していない状態
	  // ----------------------------------------
	  let didStartToolUse = false;
	  const possibleToolUseOpeningTags = toolUseNames.map((name) => `<${name}>`);
  
	  for (const toolUseOpeningTag of possibleToolUseOpeningTags) {
		if (accumulator.endsWith(toolUseOpeningTag)) {
		  // 新しいツール利用ブロックの開始
		  currentToolUse = {
			type: "tool_use",
			name: toolUseOpeningTag.slice(1, -1) as ToolUseName,
			params: {},
			partial: true,
		  };
		  currentToolUseStartIndex = accumulator.length;
  
		  // 直前までテキストコンテンツがあれば確定してブロックに追加
		  if (currentTextContent) {
			currentTextContent.partial = false;
			// テキスト末尾からツールタグ分のテキストを削除して整形
			currentTextContent.content = currentTextContent.content
			  .slice(0, -toolUseOpeningTag.slice(0, -1).length)
			  .trim();
			contentBlocks.push(currentTextContent);
			console.log(
			  `[parseAssistantMessage] テキストブロックを確定: "${currentTextContent.content}"`
			);
			currentTextContent = undefined;
		  }
  
		  console.log(
			`[parseAssistantMessage] ツール利用開始検出: ${currentToolUse.name}`
		  );
		  didStartToolUse = true;
		  break;
		}
	  }
  
	  // ツール利用開始タグが検出されなかった場合はテキストとして扱う
	  if (!didStartToolUse) {
		if (currentTextContent === undefined) {
		  // 新しいテキストブロックの開始
		  currentTextContentStartIndex = i;
		}
		currentTextContent = {
		  type: "text",
		  content: accumulator.slice(currentTextContentStartIndex).trim(),
		  partial: true,
		};
	  }
	}
  
	// ----------------------------------------
	// ■ ループ終了後の後処理
	// ----------------------------------------
	// ツール利用が未完のまま終了した場合、partialとして追加
	if (currentToolUse) {
	  // 未完のパラメータがあれば格納
	  if (currentParamName) {
		currentToolUse.params[currentParamName] = accumulator
		  .slice(currentParamValueStartIndex)
		  .trim();
		console.log(
		  `[parseAssistantMessage] ループ終了時の未完パラメータを格納: ${currentParamName} => ${currentToolUse.params[currentParamName]}`
		);
	  }
	  contentBlocks.push(currentToolUse);
	  console.log(
		`[parseAssistantMessage] ループ終了時に未完ツールを追加: ${currentToolUse.name}`
	  );
	}
  
	// 未完のテキストブロックがあれば追加
	if (currentTextContent) {
	  contentBlocks.push(currentTextContent);
	  console.log(
		`[parseAssistantMessage] ループ終了時に未完テキストを追加: "${currentTextContent.content}"`
	  );
	}
  
	console.log("[parseAssistantMessage] 完了: 解析結果を返します。", contentBlocks);
	return contentBlocks;
  };
  