import re

# 从web_fetch输出中提取博客链接
# 我们需要分析已获取的HTML内容

# 让我们搜索博客文章的模式
# 通常是 /blog/xxx 这样的链接

sample_html = '''
<a href="/blog/introducing-cowork">Introducing Cowork</a>
<a href="/blog/claude-3-5-sonnet">Claude 3.5 Sonnet</a>
'''

pattern = r'href="(/blog/[^"]*)"'
matches = re.findall(pattern, sample_html)

print("示例解析:")
for m in matches:
 print(f" https://claude.com{m}")

# 实际需要从完整的HTML中提取
