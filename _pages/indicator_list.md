---
title: Indikatorenübersicht
permalink: /indicator_list/index.html
layout: page
---

<b>Liste aller Indikatoren</b>
<br>
{% for goal in page.goals %}
  <h2>{{ goal.number }} {{ goal.name }}</h2>
  {% for indicator in page.indicators %}
    {% if indicator.goal_number == goal.number %}
      {{ indicator.number }} {{ indicator.name }}
    {% endif %}
  {% endfor %}
{% endfor %}
