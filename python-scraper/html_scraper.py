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

    prefix_tag = name_tag.find("span", class_="prefix")
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
        "memorial_id": memorial_id,
        "prefix": prefix,
        "first_name": first_name,
        "middle_name": middle_name,
        "maiden_name": maiden_name,
        "last_name": last_name,
        "suffix": suffix
    }

def parse_date(date_string):
    if date_string.lower() == "unknown":
        return {"day": None, "month": None, "year": None}
    parts = date_string.split()
    
    # 3 Jan 1923 - 5 Feb 2020
    # [3, Jan, 1923]
    # If missing a day month or year make provisions for those 
    day = parts[0] if len(parts) == 3 else None
    month = parts[-2] if len(parts) >= 2 else None
    year = parts[-1] if len(parts) >= 1 else None

    return {
        "day": day,
        "month": month,
        "year": year
    }


def extract_dates(dates_tag):
    birth_date, death_date = None, None
    if dates_tag:
        dates_text = dates_tag.get_text().strip()
        birth_date, death_date = map(str.strip, dates_text.split("–"))
        
    birth = parse_date(birth_date) if birth_date else {"day": None, "month": None, "year": None}
    death = parse_date(death_date) if death_date else {"day": None, "month": None, "year": None}
    return birth, death
    # return {"day": None, "month": None, "year": None}, {"day": None, "month": None, "year": None} # Return default values when dates_tag is None

def extract_grave_location(location_tag):
    if location_tag:
        location_text = location_tag.find("strong").get_text().strip() if location_tag.find("strong") else ""
        section_match = re.search(r"(?:Sec(?:tion)?\s+)?([A-Za-z]+)", location_text, re.IGNORECASE)
        lot_match = re.search(r"(\d+)", location_text, re.IGNORECASE)
        section = section_match.group(1).split()[-1].upper() if section_match else None

        # Process lot - convert to integer or None
        try:
            lot = int(lot_match.group(1)) if lot_match else None
        except (ValueError, AttributeError):
            lot = None

        return {
            "section": section,
            "lot": lot
        }
    return {
        "section": None,
        "lot": None
    }

# Open the file
with open("honeyford.html", "r", encoding="utf-8") as HTML_file:
    soup = BeautifulSoup(HTML_file, "html.parser")

# Find the parent tag for memorials
memorials = soup.find_all("div", attrs={"role": "group", "aria-label": "Memorial"})

# Create a list of dictionaries to store the data
data = []

for memorial in memorials:
    #  Extract the fields from the memorial
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
        **name_details,
        "is_vet": veteran_status,
        "birth_day": birth["day"],
        "birth_month": birth["month"],
        "birth_year": birth["year"],
        "death_day": death["day"],
        "death_month": death["month"],
        "death_year": death["year"],
        **grave_location
    })

# Write the data to a CSV file
with open("parsed_names_honeyford.csv", "w", encoding="utf-8", newline="") as CSV_file:
    fieldnames = [
        "memorial_id", "prefix", "first_name", "middle_name", "maiden_name", "last_name", "suffix", "is_vet", "birth_day", "birth_month", "birth_year", "death_day", "death_month", "death_year", "section", "lot"
    ]
    writer = csv.DictWriter(CSV_file, fieldnames=fieldnames)
    
    writer.writeheader()
    writer.writerows(data)

print("Data written to CSV file")
