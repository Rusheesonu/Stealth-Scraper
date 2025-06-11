
Input validation

More robust scraping (handling headers, JS-loaded sites)

Docker setup

User auth or API keys for scraping limits



title : //div[@class='col-sm-6 product_main']/h1
price :(//p[@class="price_color"])[1]
stock : (//p[@class='instock availability'])[1]
description  : //article[@class='product_page']/p

https://books.toscrape.com/catalogue/the-requiem-red_995/index.html



## target 


title : //h1[@id='pdp-product-title-id']
tags : //nav[@class='styles_ndsBreadcrumbNav__F_2Ga']/ol
price : {\\\"current_retail\\\":(.*?),
description : //div[2]/div/div/div[@class='h-margin-t-x2']
images : //div[@class='styles_zoomableImage__R_OOf']/img/@src