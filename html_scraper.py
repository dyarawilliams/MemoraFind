from bs4 import BeautifulSoup
import csv
import re

def extract_name_details(name_url, name_tag):
    url_parts = name_url.split("/")
    memorial_id = url_parts[2]
    name_parts = url_parts[3].split("-")
    name_parts = [name_parts.title() for name_parts in name_parts]
    
    # Extract prefix, first name, middle name, maiden name, last name, suffix
    first_name = name_parts[0].replace("-", " ")
    middle_name =  name_parts[1].replace("-", " ") if len(name_parts) == 3 else ""
    last_name = name_parts[-1].replace("-", " ")

    full_text = name_tag.get_text()

    prefix_tag = name_tag.find("span", class_="prefix") if prefix_tag else ""
    prefix = prefix_tag.get_text() if prefix_tag else ""

    maiden_tag = name_tag.find("i")
    maiden_name = maiden_tag.get_text() if maiden_tag else ""

    nickname_match = re.search(r'“([^”]+)”', full_text)
    nickname = nickname_match.group(1) if nickname_match else ""

    if nickname:
        first_name = f'{first_name} {nickname}'

    suffix = ""
    if full_text.split()[-1] in ["Jr.", "Sr.", "II", "III", "IV", "V", "MD"]:
        suffix = full_text.split()[-1]
    
    return {
        "MEMORIAL_ID": memorial_id,
        "PREFIX": prefix,
        "FIRST_NAME": first_name,
        "MIDDLE_NAME": middle_name,
        "MAIDEN_NAME": maiden_name,
        "LAST_NAME": last_name,
        "SUFFIX": suffix
    }



# Open the file
with open("bcmg.html", "r", encoding="utf-8") as HTML_file:
    soup = BeautifulSoup(HTML_file, "html.parser")

# Find the parent tag for memorials
memorials = soup.find_all("div", attrs={"role": "group", "aria-label": "Memorial"})

# Create a list of dictionaries to store the data
data = []

for memorial in memorials:
    name_url = memorial.find("a").get("href")
    name_tag = memorial.find("i", class_="pe-2")
    veteran_tag = memorial.find("span", title="Veteran")
    dates_tag = memorial.find("b", class_="birthDeathDates fw-light fs-5 text-body")
    location_tag = memorial.find("p", class_="addr-cemet mb-1")

    # print("URL:", name_url, "\nName:", name_tag, "\nIS VET: ", veteran_tag, "\nDates:" , dates_tag, "\nGrave Location:", location_tag, "\n=====================")

    # Call functions to extract fields and fill data list with dictionary elements for each memorial

    name_details = extract_name_details(name_url, name_tag)
    birth, death = extract_dates(dates_tag)
    grave_location = extract_grave_location(location_tag)
    veteran_status = "Y" if veteran_tag else ""
    
    data.append({

    })

# Write the data to a CSV file
with open("parsed_names_bcmg_1.csv", "w", encoding="utf-16", newline="") as CSV_file:
    fieldnames = [
        MEMORIAL_ID, PREFIX, FIRST_NAME, MIDDLE_NAME, MAIDEN_NAME, LAST_NAME, SUFFIX, VETERAN, BIRTH_DAY, BIRTH_MONTH, BIRTH_YEAR, DEATH_DAY, DEATH_MONTH, DEATH_YEAR, SECTION, LOT
    ]
    writer = csv.DictWriter(CSV_file, fieldnames=fieldnames)
    
    writer.writeheader()
    writer.writerows(data)
