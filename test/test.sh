
# テスト用のスクリプト
test_dir="/home/gorillabbit/RAIMEI/test"

# test.txtが存在しないことを確認
if [ -f "$test_dir/test.txt" ]; then
  rm "$test_dir/test.txt"
fi
# テスト用のファイルを作成
# 空のファイルを作ることができない
npx node build/index.js "$test_dir" "test.txtファイルを作って「こんにちは」と書いてください" gemini

# test.txtが存在することを確認
if [ ! -f "$test_dir/test.txt" ]; then
  echo "test.txtファイルが作成されていません"
  exit 1
fi

# test.txtの中身を編集
cat "$test_dir/test.txt"
npx node build/index.js "$test_dir" "test.txtファイルを「あいうえお」と書き換えてしてください" gemini

# test.txtの中身が編集されていることを確認
if [ "$(cat "$test_dir/test.txt")" == "あいうえお" ]; then
  echo "test.txtが正しく編集されました"
else
  echo "test.txtの編集内容が期待通りではありません"
  echo "実際の内容: $(cat "$test_dir/test.txt")"
  exit 1
fi

# test.txtを削除
rm "$test_dir/test.txt"

# test.txtが削除されていることを確認
if [ -f "$test_dir/test.txt" ]; then
  echo "test.txtファイルが削除されていません"
  exit 1
fi

npx node build/index.js "/home/gorillabbit/RAIMEI" "$test_dir/ に自己紹介を二個のファイルを作って書いてください" gemini
# テストディレクトリに2つファイルがあれば成功
if [ "$(ls -1 "$test_dir" | wc -l)" -eq 2 ]; then
  echo "2つのファイルが作成されました"
else
  echo "2つのファイルが作成されていません"
  exit 1
fi

# テストディレクトリにあるファイルを削除
rm "$test_dir"/*


# コマンドが実行できるか確認する
if npx node build/index.js "$test_dir" "lsを実行してください" gemini; then
  echo "コマンドが正常に実行されました"
else
  echo "コマンドの実行に失敗しました"
  exit 1
fi