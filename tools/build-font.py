# 둥근 글꼴(주아, SIL OFL)을 index.html 맨 아래 <style id="font">에 넣음.
# 흔히 쓰는 한글 2350자, 영문과 숫자, index.html에 쓰인 글자만 남겨 크기를 줄임.
# 화면 글에 새 글자를 넣었는데 문법 검사가 「글꼴에 없는 글자」를 알리면 이걸 다시 돌림.
# 사용: pip install fonttools brotli && python3 tools/build-font.py
import base64, io, os, re, sys, urllib.request
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.join(os.path.dirname(__file__), '..')
HTML = os.path.join(ROOT, 'index.html')
SRC = 'https://raw.githubusercontent.com/google/fonts/main/ofl/jua/Jua-Regular.ttf'
CACHE = os.path.join(os.path.dirname(__file__), '.Jua-Regular.ttf')

if not os.path.exists(CACHE):
    urllib.request.urlretrieve(SRC, CACHE)
html = open(HTML, encoding='utf-8').read()
start, end = '<style id="font">', '</style><!--font-->'
body = re.sub(re.escape(start) + '.*?' + re.escape(end), '', html, flags=re.S)
ks = ''
for hi in range(0xB0, 0xC9):
    for lo in range(0xA1, 0xFF):
        try: ks += bytes([hi, lo]).decode('euc-kr')
        except UnicodeDecodeError: pass
used = ''.join(sorted(set(ch for ch in body if ord(ch) > 126)))
text = ks + ''.join(chr(i) for i in range(32, 127)) + used
font = TTFont(CACHE)
opt = subset.Options(); opt.flavor = 'woff2'; opt.layout_features = ['*']
sub = subset.Subsetter(opt); sub.populate(text=text); sub.subset(font)
buf = io.BytesIO(); font.flavor = 'woff2'; font.save(buf)
b64 = base64.b64encode(buf.getvalue()).decode()
cmap = font.getBestCmap()
have = ''.join(sorted(set(ch for ch in used if ord(ch) in cmap)))
block = (start + "\n/* 주아 (Jua, SIL Open Font License 1.1, docs/fonts/OFL-Jua.txt). tools/build-font.py로 만듦\n"
         + "   덤 글자: " + ''.join(ch for ch in have if not ('가' <= ch <= '힣' and ch in ks)) + " */\n"
         + "@font-face{font-family:'Jua';font-style:normal;font-weight:400;font-display:block;src:url(data:font/woff2;base64," + b64 + ") format('woff2')}\n"
         + end)
if end in html: html = re.sub(re.escape(start) + '.*?' + re.escape(end), lambda m: block, html, flags=re.S)
else: html = html.replace('</body>', block + '\n</body>')
open(HTML, 'w', encoding='utf-8').write(html)
print('글꼴 넣음: %d바이트, 글자 %d개' % (len(buf.getvalue()), len(cmap)))
