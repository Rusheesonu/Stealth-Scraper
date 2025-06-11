from flask import Flask, render_template, request, jsonify
from scraper.core import scrape_url  # assumes scrape_url has mode param

app = Flask(__name__)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/scrape', methods=['POST'])
def scrape():
    data = request.get_json()
    url = data.get('url')
    rules_raw = data.get('rules', '')
    mode = data.get('mode', 'requests')  # <-- NEW LINE (default to requests)
    print("MODE from client:", mode)
    rules = [line.strip() for line in rules_raw.splitlines() if line.strip()]

    if not url:
        return jsonify({"error": "No URL provided"}), 400
    if not rules:
        return jsonify({"error": "No extraction rules provided"}), 400

    results = scrape_url(url, rules, mode=mode)  # <-- PASS mode
    return jsonify(results)

if __name__ == '__main__':
    app.run(debug=True)

